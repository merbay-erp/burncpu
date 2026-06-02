-- Passkeys (WebAuthn). An additive second login method alongside magic-link:
-- a user may register one or more platform/roaming authenticators and sign in
-- with a discoverable (usernameless) credential. Each row is one credential.

CREATE TABLE webauthn_credentials (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cred_id       BYTEA NOT NULL UNIQUE,   -- raw credential id (dedup + match on auth)
    passkey       JSONB NOT NULL,          -- serialized webauthn_rs::prelude::Passkey
    name          TEXT,                    -- user-supplied label, e.g. "iPhone"
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ
);

CREATE INDEX webauthn_credentials_user_idx ON webauthn_credentials(user_id);
