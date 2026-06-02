-- Per-webhook delivery log: a sliding window of the most recent attempts
-- (event, HTTP status, ok, short failure reason). Bounded in-place by the
-- dispatcher (insert + inline prune to the latest N per webhook), so there is
-- no retention cron — "bound it where you write it".

CREATE TABLE webhook_deliveries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id  UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event       TEXT NOT NULL,
    status      SMALLINT,        -- HTTP status; NULL when no response (blocked / network)
    ok          BOOLEAN NOT NULL,
    error       TEXT,            -- short failure reason when not ok
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX webhook_deliveries_idx ON webhook_deliveries(webhook_id, created_at DESC);
