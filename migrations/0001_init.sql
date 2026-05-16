-- burncpu v0.1 schema
-- Single migration creates the full minimal social graph: users, sessions,
-- posts, media, follows, reactions, replies, moderation_log.
-- Designed to be additive — future migrations alter, never rewrite.

-- ─── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

-- ─── Users ────────────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE NOT NULL,
    username        VARCHAR(32) UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_]{3,32}$'),
    display_name    VARCHAR(80) NOT NULL,
    bio             VARCHAR(280),
    avatar_url      TEXT,
    role            VARCHAR(16) NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin', 'member', 'suspended')),
    invited_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ
);
CREATE INDEX users_created_idx ON users(created_at DESC);

-- ─── Magic-link tokens ────────────────────────────────────────
-- Auth: email → token → session. No passwords stored.
CREATE TABLE auth_tokens (
    token_hash      BYTEA PRIMARY KEY,
    email           CITEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    ip              INET,
    user_agent      VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_tokens_email_idx ON auth_tokens(email, created_at DESC);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens(expires_at);

-- ─── Sessions ─────────────────────────────────────────────────
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      BYTEA UNIQUE NOT NULL,
    ip              INET,
    user_agent      VARCHAR(255),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions(user_id, created_at DESC);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- ─── Posts ────────────────────────────────────────────────────
-- Body is markdown source; body_html is the sanitized cached render.
-- Visibility 'public' = everyone, 'followers' = followee-only feed,
-- 'private' = author only (draft).
CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    body_html       TEXT NOT NULL,
    visibility      VARCHAR(16) NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public', 'followers', 'private')),
    reply_to_id     UUID REFERENCES posts(id) ON DELETE SET NULL,
    repost_of_id    UUID REFERENCES posts(id) ON DELETE SET NULL,
    spam_score      SMALLINT,                     -- 0-100, AI moderation
    moderation_state VARCHAR(16) NOT NULL DEFAULT 'live'
                    CHECK (moderation_state IN ('live', 'quarantine', 'removed')),
    reactions_count INTEGER NOT NULL DEFAULT 0,
    replies_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX posts_author_idx ON posts(author_id, created_at DESC);
CREATE INDEX posts_timeline_idx ON posts(created_at DESC)
    WHERE moderation_state = 'live' AND deleted_at IS NULL AND visibility = 'public';
CREATE INDEX posts_replies_idx ON posts(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- ─── Media ────────────────────────────────────────────────────
CREATE TABLE post_media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    kind            VARCHAR(16) NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
    url             TEXT NOT NULL,
    mime_type       VARCHAR(64) NOT NULL,
    width           INTEGER,
    height          INTEGER,
    duration_ms     INTEGER,
    size_bytes      BIGINT,
    alt_text        VARCHAR(500),
    ordinal         SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX post_media_post_idx ON post_media(post_id, ordinal);

-- ─── Follows ──────────────────────────────────────────────────
CREATE TABLE follows (
    follower_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows(followee_id, created_at DESC);

-- ─── Reactions ────────────────────────────────────────────────
-- Per-(user, post) one reaction. Emoji set is closed (5 options) to keep
-- UI simple and analytics tractable.
CREATE TABLE reactions (
    post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji           VARCHAR(4) NOT NULL CHECK (emoji IN ('🔥', '🐢', '🤝', '🙏', '😂')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX reactions_user_idx ON reactions(user_id, created_at DESC);
CREATE INDEX reactions_emoji_idx ON reactions(post_id, emoji);

-- ─── Moderation log ───────────────────────────────────────────
-- Append-only audit trail. Every automatic AI decision + every manual
-- admin action lands here. Powers the operations dashboard.
CREATE TABLE moderation_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_kind     VARCHAR(16) NOT NULL CHECK (target_kind IN ('post', 'user', 'reaction')),
    target_id       UUID NOT NULL,
    action          VARCHAR(32) NOT NULL,
    actor_kind      VARCHAR(16) NOT NULL CHECK (actor_kind IN ('ai', 'admin', 'system')),
    actor_id        UUID REFERENCES users(id),
    reason          TEXT,
    ai_score        SMALLINT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX moderation_log_target_idx ON moderation_log(target_kind, target_id, created_at DESC);
CREATE INDEX moderation_log_actor_idx ON moderation_log(actor_kind, created_at DESC);

-- ─── Invites ──────────────────────────────────────────────────
-- Invite-only signup: existing user generates a code, new user redeems.
CREATE TABLE invites (
    code            VARCHAR(32) PRIMARY KEY,
    inviter_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_by     UUID REFERENCES users(id),
    redeemed_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX invites_inviter_idx ON invites(inviter_id, created_at DESC);
