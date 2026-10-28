BEGIN;

CREATE TABLE pic_sync_web_push_test_subscriptions (
  id text PRIMARY KEY,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time bigint,
  credential_hash text NOT NULL,
  last_test_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pic_sync_web_push_test_subscriptions_endpoint_uq
  ON pic_sync_web_push_test_subscriptions (endpoint);

CREATE UNIQUE INDEX pic_sync_web_push_test_subscriptions_credential_hash_uq
  ON pic_sync_web_push_test_subscriptions (credential_hash);

COMMIT;
