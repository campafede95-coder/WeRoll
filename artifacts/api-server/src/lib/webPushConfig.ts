import * as webpush from "web-push";

export function configureVapid() {
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
