import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type DevicePushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function createDeviceCredential() {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceCredential(credential: string) {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

export function deviceCredentialMatches(credential: string, expectedHash: string) {
  if (!/^[A-Fa-f0-9]{64}$/.test(expectedHash) || credential.length < 32 || credential.length > 200) return false;
  const actual = Buffer.from(hashDeviceCredential(credential), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function bearerCredential(authorization: string | undefined) {
  if (!authorization || authorization.length > 512) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{40,200})$/.exec(authorization);
  return match?.[1] ?? null;
}

export function isAllowedWebPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com" || host.endsWith(".fcm.googleapis.com") ||
      host === "push.apple.com" || host.endsWith(".push.apple.com") ||
      host === "push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com");
  } catch {
    return false;
  }
}

export async function sendAuthorizedDeviceTest<T>(input: {
  credential: string | null;
  expectedCredentialHash: string;
  requestedEndpoint: string;
  storedEndpoint: string;
  send: () => Promise<T>;
}) {
  if (!input.credential || input.requestedEndpoint !== input.storedEndpoint ||
    !deviceCredentialMatches(input.credential, input.expectedCredentialHash)) {
    return { authorized: false as const };
  }
  return { authorized: true as const, result: await input.send() };
}

// Internal routing reference only: never an Expo token or a bearer credential.
export const WEB_PUSH_TOKEN_PREFIX = "webpush:";
export function webPushToken(subscriptionId: string) { return `${WEB_PUSH_TOKEN_PREFIX}${subscriptionId}`; }
export function isWebPushToken(token: string) { return token.startsWith(WEB_PUSH_TOKEN_PREFIX); }
