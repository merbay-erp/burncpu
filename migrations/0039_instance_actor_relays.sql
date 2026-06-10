-- 0039: instance actor + relay subscriptions — the firehose side of federation
-- consumption (100k roadmap). Until now the instance only consumed content from
-- remote actors that *local users follow* (migration 0038). A relay subscription
-- pulls a broader firehose without following anyone: the instance Follows a
-- relay's actor, the relay Accepts, then forwards its members' activities to the
-- instance inbox. That needs (a) a dedicated instance "Application" actor the
-- relay can speak to, and (b) a record of which relays we've subscribed to.
--
-- Security note: relay-forwarded activities are signed by the *relay*, not by the
-- original author (signer ≠ actor). So the inbox verifies the relay's signature
-- to prove the relay sent it, then re-fetches the post from its own canonical
-- origin before storing (same guard as Announce in 0038) — a relay can never
-- forge content under another instance's name. Relays are admin-added only; the
-- firehose is never auto-enabled.

-- Singleton instance-actor keypair (one row, id is always true). The private key
-- is encrypted at rest with the same app-level secretbox as per-user actor keys
-- (auth::totp::encrypt_blob), never stored in the clear.
CREATE TABLE instance_actor (
    id                    BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    private_key_encrypted BYTEA NOT NULL,
    private_key_nonce     BYTEA NOT NULL,
    public_key_pem        TEXT  NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscribed relays. The admin adds a relay by its actor URI; we fetch its inbox
-- + key, POST a Follow signed by the instance actor, and flip 'pending'→'active'
-- when the relay's Accept lands.
CREATE TABLE federation_relays (
    actor_uri     TEXT PRIMARY KEY,
    inbox         TEXT NOT NULL,
    state         TEXT NOT NULL DEFAULT 'pending',   -- pending | active | disabled
    follow_id     TEXT,                              -- the Follow activity id we sent
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at   TIMESTAMPTZ
);
