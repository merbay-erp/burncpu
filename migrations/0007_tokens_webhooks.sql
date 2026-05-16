-- 0007 — Developer API: bearer tokens + outgoing webhooks

-- ─── API tokens ────────────────────────────────────────────────
-- Bearer token issued to a user. Same storage strategy as magic-link /
-- session: raw shown ONCE at creation, sha256(raw) persisted. Scope is
-- coarse for v1: "all" = full account power, "read" = GET-only.
CREATE TABLE api_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(64) NOT NULL,
    token_hash      BYTEA UNIQUE NOT NULL,
    scope           VARCHAR(16) NOT NULL DEFAULT 'all'
                    CHECK (scope IN ('all', 'read')),
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,                  -- null = never
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX api_tokens_user_idx ON api_tokens(user_id, created_at DESC);

-- ─── Webhooks ──────────────────────────────────────────────────
-- Outgoing event subscriptions. When notify() fires for a user, any
-- matching webhook is POSTed asynchronously with a HMAC-SHA256 signature
-- header (`X-Burncpu-Signature: sha256=<hex>`) so the receiver can verify
-- the payload came from us. Failures are recorded in last_status.
CREATE TABLE webhooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url             TEXT NOT NULL CHECK (url ~ '^https?://'),
    secret          TEXT NOT NULL,        -- shared secret for HMAC signing
    events          TEXT[] NOT NULL,      -- ['reaction','reply','follow','mention','dm']
    active          BOOLEAN NOT NULL DEFAULT true,
    last_called_at  TIMESTAMPTZ,
    last_status     SMALLINT,
    failure_streak  INTEGER NOT NULL DEFAULT 0,   -- auto-disable after 20
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX webhooks_user_idx ON webhooks(user_id, created_at DESC);
CREATE INDEX webhooks_active_idx ON webhooks(user_id) WHERE active = true;
