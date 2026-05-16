-- burncpu v0.2 — security additions
-- 1. audit_log:       per-request trail (request_id, method, path, status, ip)
-- 2. login_attempts:  every magic-link request/verify, success/fail
-- 3. totp_secret:     admin 2FA — TOTP shared secret + recovery codes
-- 4. session_last_ip: detect hijack (UA/IP delta during session)

-- ─── Audit log ────────────────────────────────────────────────
-- One row per HTTP request. Partition by month once volume grows.
CREATE TABLE audit_log (
    id            UUID PRIMARY KEY,
    method        VARCHAR(10) NOT NULL,
    path          VARCHAR(512) NOT NULL,
    status        SMALLINT NOT NULL,
    latency_ms    INTEGER NOT NULL,
    ip            INET,
    user_agent    VARCHAR(255),
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_ts_idx     ON audit_log(ts DESC);
CREATE INDEX audit_log_status_idx ON audit_log(status, ts DESC) WHERE status >= 400;
CREATE INDEX audit_log_ip_idx     ON audit_log(ip, ts DESC);
CREATE INDEX audit_log_user_idx   ON audit_log(user_id, ts DESC) WHERE user_id IS NOT NULL;

-- ─── Login attempts ───────────────────────────────────────────
-- Tracks both /auth/request AND /auth/verify outcomes.
-- Use case: brute-force detection per-IP, lockout, alert.
CREATE TABLE login_attempts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       CITEXT,                       -- nullable: invalid emails too
    kind        VARCHAR(16) NOT NULL          -- 'request' | 'verify' | 'totp'
                CHECK (kind IN ('request', 'verify', 'totp')),
    outcome     VARCHAR(16) NOT NULL          -- 'ok' | 'rate_limited' | 'invalid' | 'expired' | 'consumed'
                CHECK (outcome IN ('ok', 'rate_limited', 'invalid', 'expired', 'consumed', 'totp_required')),
    ip          INET,
    user_agent  VARCHAR(255),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX login_attempts_email_idx ON login_attempts(email, ts DESC);
CREATE INDEX login_attempts_ip_idx    ON login_attempts(ip, ts DESC);
CREATE INDEX login_attempts_recent_idx ON login_attempts(ts DESC);

-- ─── TOTP (admin 2FA) ─────────────────────────────────────────
-- Secret stored encrypted at the application layer (XChaCha20-Poly1305
-- with key from env). Recovery codes are pre-hashed (sha256).
CREATE TABLE user_totp (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted  BYTEA NOT NULL,
    secret_nonce      BYTEA NOT NULL,         -- per-secret nonce
    confirmed_at      TIMESTAMPTZ,            -- null until first valid TOTP entered
    recovery_codes    BYTEA[] NOT NULL DEFAULT '{}',
    last_used_step    BIGINT,                 -- prevent replay (TOTP step counter)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Session forensics ────────────────────────────────────────
-- Add columns to existing sessions table for hijack detection.
ALTER TABLE sessions
    ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN last_seen_ip INET,
    ADD COLUMN last_seen_ua VARCHAR(255),
    ADD COLUMN flagged_at   TIMESTAMPTZ;       -- set when IP/UA change detected

-- ─── Helper: cleanup expired tokens/sessions ───────────────────
-- Run via cron (pg_cron later, manual for now).
COMMENT ON TABLE auth_tokens IS 'Cleanup: DELETE WHERE expires_at < now() - interval ''1 day''';
COMMENT ON TABLE sessions IS 'Cleanup: DELETE WHERE expires_at < now() OR (revoked_at IS NOT NULL AND revoked_at < now() - interval ''30 days'')';
COMMENT ON TABLE audit_log IS 'Cleanup: DELETE WHERE ts < now() - interval ''90 days''';
