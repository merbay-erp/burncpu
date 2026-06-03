-- OAuth social-login identities. Links a provider account (Google / GitHub /
-- Microsoft / …) to a burncpu user. One identity per provider per user; a
-- given provider account maps to exactly one user (PK on provider+provider_id).
-- Matching/creation always happens on a provider-VERIFIED email, so this never
-- becomes an account-takeover vector.
CREATE TABLE oauth_identities (
    provider     VARCHAR(32)  NOT NULL,
    provider_id  VARCHAR(255) NOT NULL,   -- provider's stable user id (sub / numeric id)
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email        CITEXT,
    name         TEXT,
    avatar_url   TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_id),
    UNIQUE (user_id, provider)
);

CREATE INDEX oauth_identities_user_idx ON oauth_identities(user_id);
