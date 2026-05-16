-- 0008 — Web Push subscriptions
--
-- One row per (browser, user). The endpoint is the push-service URL the
-- browser hands us at subscription time; p256dh + auth are the keys we
-- need to encrypt payloads. Endpoint is UNIQUE — a re-subscribe replaces.

CREATE TABLE push_subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT UNIQUE NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    failures    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id);
