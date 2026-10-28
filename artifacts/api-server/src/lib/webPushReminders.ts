import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  participantsTable,
  pushTokensTable,
  webPushTestSubscriptionsTable,
} from "@workspace/db";
import * as webpush from "web-push";
import { configureVapid } from "./webPushConfig";
import {
  isAllowedWebPushEndpoint,
  isWebPushToken,
  webPushToken,
} from "./devicePush";

type QueryDb = Pick<typeof db, "select" | "delete">;
export type WebRecipient = typeof webPushTestSubscriptionsTable.$inferSelect;

export async function webRecipients(
  userIds: string[],
  now: Date,
  source: QueryDb = db,
) {
  if (!userIds.length) return [];
  const bindings = await source
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(
      and(
        inArray(pushTokensTable.userId, userIds),
        eq(pushTokensTable.platform, "web"),
      ),
    );
  const ids = bindings
    .filter(({ token }) => isWebPushToken(token))
    .map(({ token }) => token.slice("webpush:".length));
  if (!ids.length) return [];
  const subscriptions = await source
    .select()
    .from(webPushTestSubscriptionsTable)
    .where(inArray(webPushTestSubscriptionsTable.id, ids));
  return subscriptions.filter(
    (row) =>
      isAllowedWebPushEndpoint(row.endpoint) &&
      (row.expirationTime === null || row.expirationTime > now.getTime()),
  );
}

export function reminderPayload(input: {
  experienceId: string;
  reminderId: string;
  scheduledAt: Date;
  title: string;
  organizerName: string;
  messageVariant: string;
}) {
  return {
    title: `${input.organizerName} · ${input.title}`,
    body: `${input.organizerName} ti invita a scattare: hai 15 minuti per questo ricordo.`,
    experienceId: input.experienceId,
    reminderId: input.reminderId,
    scheduledAt: input.scheduledAt.toISOString(),
    messageVariant: input.messageVariant,
    tag: `${input.experienceId}:${input.reminderId}`,
    icon: "/icon.png",
    badge: "/icon.png",
  };
}

// Recheck the binding at send time: a stale lease must not target a device
// which has been revoked or has changed guest identity.
export async function stillEligible(
  source: QueryDb,
  experienceId: string,
  recipient: WebRecipient,
) {
  const members = await source
    .select({ userId: participantsTable.userId })
    .from(participantsTable)
    .where(eq(participantsTable.experienceId, experienceId));
  return (
    await webRecipients(
      members.map(({ userId }) => userId),
      new Date(),
      source,
    )
  ).some(
    (row) =>
      row.id === recipient.id &&
      row.endpoint === recipient.endpoint &&
      row.updatedAt.getTime() === recipient.updatedAt.getTime(),
  );
}

export async function sendWebReminder(
  recipient: WebRecipient,
  payload: ReturnType<typeof reminderPayload>,
  now = Date.now(),
  send = webpush.sendNotification,
  configure = configureVapid,
): Promise<"accepted" | "invalid" | "pending" | "expired"> {
  const remaining = new Date(payload.scheduledAt).getTime() + 15 * 60_000 - now;
  if (remaining <= 0) return "expired";
  if (recipient.expirationTime !== null && recipient.expirationTime <= now)
    return "invalid";
  if (!isAllowedWebPushEndpoint(recipient.endpoint)) return "invalid";
  if (!configure()) return "pending";
  try {
    await send(
      {
        endpoint: recipient.endpoint,
        keys: { p256dh: recipient.p256dh, auth: recipient.auth },
      },
      JSON.stringify(payload),
      { TTL: Math.max(1, Math.floor(remaining / 1000)), timeout: 20_000 },
    );
    return "accepted";
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    return status === 404 || status === 410 ? "invalid" : "pending";
  }
}

export async function removeWebRecipient(
  source: QueryDb,
  recipient: WebRecipient,
) {
  await source
    .delete(pushTokensTable)
    .where(eq(pushTokensTable.token, webPushToken(recipient.id)));
  await source
    .delete(webPushTestSubscriptionsTable)
    .where(eq(webPushTestSubscriptionsTable.id, recipient.id));
}
