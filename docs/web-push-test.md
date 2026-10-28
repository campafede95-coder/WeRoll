# Web Push manual test

This flow is deliberately device-scoped. It does not use `x-pic-sync-guest-id`, does not associate a subscription with a group, and does not use the Expo test endpoint. A server-generated random capability is returned once at registration; only its SHA-256 hash is stored. The test route resolves that capability to one database row and sends only to that row's push endpoint. The browser stores the capability in its local app storage; anyone who can execute script in the app origin could access it, so keep the PWA origin protected from XSS.

## Required backend configuration

- `DATABASE_URL`: the PostgreSQL URL already used by this API.
- `PORT`: the API listener port, as before.
- `WEB_PUSH_VAPID_PUBLIC_KEY`: the existing public VAPID key.
- `WEB_PUSH_VAPID_PRIVATE_KEY`: the matching private VAPID key; server-side only.
- `WEB_PUSH_VAPID_SUBJECT`: a `mailto:` contact or HTTPS URL.
- Keep the existing Expo photo reminder worker running. This minimal selection retains the original worker implementation and does not add a worker-disable flag.

No automatic Web Push reminder delivery is implemented by this manual-test change. `WEB_PUSH_REMINDER_DELIVERY_ENABLED` is therefore not read or needed yet; no reminder Web Push is sent by this code.

The web build must receive `EXPO_PUBLIC_API_URL` pointing at the deployed HTTPS API. It contains no private VAPID value.

## Database migration

The local Drizzle schema adds the standalone `pic_sync_web_push_test_subscriptions` table. The additive migration is `lib/db/migrations/20261021_web_push_test_subscriptions.sql`. Do not run `drizzle-kit push` as part of server startup. Review and apply this SQL manually to the intended database, after an authorized backup and read-only preflight, using a stop-on-error command such as:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/20261021_web_push_test_subscriptions.sql
```

This file has not been applied to any database by this change.

## Local API commands

After a deliberate local build, `pnpm --filter @workspace/api-server run start` starts the bundle without schema synchronization. The explicit `pnpm --filter @workspace/api-server run schema:push` still invokes Drizzle push and must be treated as a schema-changing operation. Use the normal `start` command in production. There is no `start:web-push-test` script in this selection. Starting the server also starts the existing Expo reminder worker; do not start it against production merely to validate a build.

The `POST /api/web-push/subscriptions/test` endpoint requires the device capability and has a per-device 30-second cooldown. A successful response means the push provider accepted the request; it cannot confirm delivery or display on the iPhone. The existing Expo test remains unchanged for native builds and is not used by the web controls.

## Cloudflare web export

From the repository root:

```sh
EXPO_PUBLIC_API_URL=https://weroll-production.up.railway.app pnpm --filter @workspace/mobile exec expo export --platform web --output-dir dist-webpush-iphone
```

The API URL is embedded at build time. Do not use the mobile `build` script (it generates an Expo Go deployment). Verify `index.html` links `/manifest.json`, includes the generated entry script, and exports `/service-worker.js` and `/icon.png`. Deploy only `artifacts/mobile/dist-webpush-iphone/` to the existing Cloudflare Pages project, preserving SPA navigation fallback. No private VAPID key belongs in the frontend. The current `public/index.html` supplies the standalone PWA metadata.

On iOS 16.4+, add the HTTPS site to the Home Screen and open that app. Use an active experience belonging only to the tester; press “Attiva notifiche web”, grant permission, then press “Invia test Web Push” once. HTTP 202 only confirms provider acceptance. Check the iPhone notification center; optionally deactivate this device afterward. Do not use the Expo test endpoint or change schedules in shared experiences.

If local device storage is lost after registration, the backend deliberately refuses to overwrite the existing endpoint (409). Stop and diagnose that single device rather than retrying or deleting unrelated registrations.
