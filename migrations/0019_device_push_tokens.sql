-- Native mobile push tokens (APNs / FCM), registered by the iOS/Android app via
-- POST /push/device. Distinct from web Web-Push subscriptions (push_subscriptions).
-- Delivery to these requires an APNs key / FCM credential configured server-side.

CREATE TABLE device_push_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    platform    TEXT NOT NULL,            -- 'ios' | 'android'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX device_push_tokens_user_idx ON device_push_tokens(user_id);
