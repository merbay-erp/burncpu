-- 0009 — ActivityPub federation
--
-- Per-user RSA-2048 keypair (the standard for HTTP Signatures + AP).
-- Private key is stored in PEM form, app-layer XChaCha20-Poly1305
-- encrypted with BURNCPU_ENC_KEY (same key used for TOTP secrets).
-- Public key is stored in PEM and also exposed in the actor JSON.
--
-- federation_followers: every remote (off-instance) follow of a local
-- user. Local-local follows still go through the `follows` table.
--
-- federation_actors: cached remote actor docs (so we don't refetch on
-- every signature verification).
--
-- federation_activities: idempotency log keyed by activity `id` URI so
-- duplicate deliveries no-op.

ALTER TABLE users
    ADD COLUMN actor_private_key_encrypted BYTEA,
    ADD COLUMN actor_private_key_nonce     BYTEA,
    ADD COLUMN actor_public_key_pem        TEXT;

CREATE TABLE federation_actors (
    uri           TEXT PRIMARY KEY,
    username      TEXT NOT NULL,         -- e.g. "alice"
    host          TEXT NOT NULL,         -- e.g. "mastodon.social"
    inbox         TEXT NOT NULL,
    shared_inbox  TEXT,
    public_key_pem TEXT NOT NULL,
    public_key_id  TEXT NOT NULL,
    actor_json    JSONB NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX federation_actors_handle_idx ON federation_actors(username, host);

CREATE TABLE federation_followers (
    local_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remote_actor_uri TEXT NOT NULL REFERENCES federation_actors(uri) ON DELETE CASCADE,
    accepted         BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (local_user_id, remote_actor_uri)
);
CREATE INDEX federation_followers_actor_idx ON federation_followers(remote_actor_uri);

CREATE TABLE federation_activities (
    activity_id  TEXT PRIMARY KEY,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kind         VARCHAR(32) NOT NULL,
    actor_uri    TEXT NOT NULL,
    direction    VARCHAR(8) NOT NULL CHECK (direction IN ('in', 'out'))
);
CREATE INDEX federation_activities_recent_idx ON federation_activities(received_at DESC);
