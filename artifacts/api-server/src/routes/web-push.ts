import { Router, type Response } from "express";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as webpush from "web-push";
import { db, webPushTestSubscriptionsTable } from "@workspace/db";
import { z } from "zod";
import { logger } from "../lib/logger";
import {
  bearerCredential,
  createDeviceCredential,
  hashDeviceCredential,
  isAllowedWebPushEndpoint,
  sendAuthorizedDeviceTest,
  type DevicePushSubscription,
} from "../lib/devicePush";

const router = Router();
const TEST_COOLDOWN_MS = 30_000;
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(32).max(200),
    auth: z.string().min(16).max(200),
  }).strict(),
  expirationTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
}).strict();

function respondError(res: Response, status: number, code: string, correlationId: string) {
  logger.info({ correlationId, statusCode: status, errorCode: code }, "Web Push request rejected");
  return res.status(status).json({ error: code, correlationId });
}

function configureVapid() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return publicKey;
  } catch {
    return null;
  }
}

function safeFailure(correlationId: string, event: string, error: unknown) {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  logger.warn({ correlationId, event, errorName }, "Web Push test request failed");
}

router.get("/vapid-public-key", (_req, res) => {
  const correlationId = randomUUID();
  res.setHeader("x-correlation-id", correlationId);
  const publicKey = configureVapid();
  if (!publicKey) {
    logger.warn({ correlationId, statusCode: 503 }, "Web Push VAPID configuration unavailable");
    return respondError(res, 503, "VAPID_NOT_CONFIGURED", correlationId);
  }
  return res.json({ publicKey });
});

router.post("/subscriptions", async (req, res) => {
  const correlationId = randomUUID();
  res.setHeader("x-correlation-id", correlationId);
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success || !isAllowedWebPushEndpoint(parsed.data.endpoint)) {
    return respondError(res, 400, "INVALID_SUBSCRIPTION", correlationId);
  }

  const credential = bearerCredential(req.header("authorization"));
  const endpoint = parsed.data.endpoint;
  const existing = await db.select({
    id: webPushTestSubscriptionsTable.id,
  }).from(webPushTestSubscriptionsTable).where(eq(webPushTestSubscriptionsTable.endpoint, endpoint)).limit(1);

  if (credential) {
    const owned = await db.select({ id: webPushTestSubscriptionsTable.id })
      .from(webPushTestSubscriptionsTable)
      .where(eq(webPushTestSubscriptionsTable.credentialHash, hashDeviceCredential(credential))).limit(1);
    if (!owned[0]) return respondError(res, 401, "DEVICE_CREDENTIAL_INVALID", correlationId);
    if (existing[0] && existing[0].id !== owned[0].id) {
      return respondError(res, 409, "SUBSCRIPTION_ALREADY_REGISTERED", correlationId);
    }
    await db.update(webPushTestSubscriptionsTable).set({
      endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      expirationTime: parsed.data.expirationTime ?? null,
      updatedAt: new Date(),
    }).where(eq(webPushTestSubscriptionsTable.id, owned[0].id));
    logger.info({ correlationId, statusCode: 200, operation: "subscription-updated" }, "Web Push device subscription updated");
    return res.status(200).json({ registered: true, correlationId });
  }
  if (existing[0]) return respondError(res, 409, "SUBSCRIPTION_ALREADY_REGISTERED", correlationId);

  const deviceCredential = createDeviceCredential();
  try {
    await db.insert(webPushTestSubscriptionsTable).values({
      id: randomUUID(),
      endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      expirationTime: parsed.data.expirationTime ?? null,
      credentialHash: hashDeviceCredential(deviceCredential),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === "23505") return respondError(res, 409, "SUBSCRIPTION_ALREADY_REGISTERED", correlationId);
    safeFailure(correlationId, "subscription-registration", error);
    return respondError(res, 500, "SUBSCRIPTION_REGISTRATION_FAILED", correlationId);
  }
  logger.info({ correlationId, statusCode: 201, operation: "subscription-registered" }, "Web Push device subscription registered");
  return res.status(201).json({ registered: true, deviceCredential, correlationId });
});

router.delete("/subscriptions", async (req, res) => {
  const correlationId = randomUUID();
  res.setHeader("x-correlation-id", correlationId);
  const credential = bearerCredential(req.header("authorization"));
  if (!credential) return respondError(res, 401, "DEVICE_CREDENTIAL_REQUIRED", correlationId);
  try {
    await db.delete(webPushTestSubscriptionsTable)
      .where(eq(webPushTestSubscriptionsTable.credentialHash, hashDeviceCredential(credential)));
    logger.info({ correlationId, statusCode: 204, operation: "subscription-revoked" }, "Web Push device subscription revoked");
    return res.status(204).send();
  } catch (error) {
    safeFailure(correlationId, "subscription-revocation", error);
    return respondError(res, 500, "SUBSCRIPTION_REVOCATION_FAILED", correlationId);
  }
});

router.post("/subscriptions/test", async (req, res) => {
  const correlationId = randomUUID();
  res.setHeader("x-correlation-id", correlationId);
  const credential = bearerCredential(req.header("authorization"));
  if (!credential) return respondError(res, 401, "DEVICE_CREDENTIAL_REQUIRED", correlationId);
  const hash = hashDeviceCredential(credential);

  try {
    const existing = await db.select().from(webPushTestSubscriptionsTable)
      .where(eq(webPushTestSubscriptionsTable.credentialHash, hash)).limit(1);
    if (!existing[0]) return respondError(res, 401, "DEVICE_CREDENTIAL_INVALID", correlationId);
    if (!configureVapid()) return respondError(res, 503, "VAPID_NOT_CONFIGURED", correlationId);
    const cutoff = new Date(Date.now() - TEST_COOLDOWN_MS);
    const eligible = await db.update(webPushTestSubscriptionsTable).set({ lastTestAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(webPushTestSubscriptionsTable.id, existing[0].id),
        or(isNull(webPushTestSubscriptionsTable.lastTestAt), lte(webPushTestSubscriptionsTable.lastTestAt, cutoff)),
      )).returning();
    if (!eligible[0]) return respondError(res, 429, "TEST_RATE_LIMITED", correlationId);

    const subscription: DevicePushSubscription = {
      endpoint: eligible[0].endpoint,
      keys: { p256dh: eligible[0].p256dh, auth: eligible[0].auth },
    };
    const authorized = await sendAuthorizedDeviceTest({
      credential,
      expectedCredentialHash: eligible[0].credentialHash,
      requestedEndpoint: eligible[0].endpoint,
      storedEndpoint: eligible[0].endpoint,
      send: () => webpush.sendNotification(subscription, JSON.stringify({
        title: "Test notifiche · WeRoll",
        body: "La notifica di prova Web Push è stata inviata a questo dispositivo.",
        tag: "weroll-web-push-test",
        icon: "/icon.png",
        badge: "/icon.png",
        url: "/",
      }), { TTL: 60 }),
    });
    if (!authorized.authorized) return respondError(res, 401, "DEVICE_CREDENTIAL_INVALID", correlationId);
    logger.info({ correlationId, statusCode: 202, providerAccepted: true }, "Web Push provider accepted device test");
    return res.status(202).json({ accepted: true, received: false, correlationId });
  } catch (error) {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
    if (statusCode === 404 || statusCode === 410) {
      await db.delete(webPushTestSubscriptionsTable)
        .where(eq(webPushTestSubscriptionsTable.credentialHash, hash)).catch(() => undefined);
      logger.warn({ correlationId, statusCode, endpointInvalid: true }, "Web Push provider rejected an expired device subscription");
      return respondError(res, 410, "SUBSCRIPTION_EXPIRED", correlationId);
    }
    safeFailure(correlationId, "provider-send", error);
    return respondError(res, 502, "PUSH_PROVIDER_FAILED", correlationId);
  }
});

export default router;
