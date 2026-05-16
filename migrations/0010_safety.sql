-- 0010 — safety primitives: block, mute, report + content warnings

-- ─── Blocks ────────────────────────────────────────────────────
-- A → B block: B can't follow A, can't DM A; A doesn't see B in any
-- list/feed/profile; B can't react/reply to A's posts. Mutual visibility
-- effectively goes to zero.
CREATE TABLE user_blocks (
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks(blocked_id);

-- ─── Mutes ─────────────────────────────────────────────────────
-- A → B mute: B is invisible to A in feeds/notifications; B doesn't
-- know. B can still see / interact with A normally.
CREATE TABLE user_mutes (
    muter_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (muter_id, muted_id),
    CHECK (muter_id <> muted_id)
);

-- ─── Reports ───────────────────────────────────────────────────
-- Open queue for admin. target_kind = 'post' | 'user' | 'dm'.
CREATE TABLE reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_kind   VARCHAR(16) NOT NULL CHECK (target_kind IN ('post', 'user', 'dm')),
    target_id     UUID NOT NULL,
    reason        VARCHAR(32) NOT NULL,    -- 'spam' | 'harassment' | 'illegal' | 'other'
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ,
    resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution    VARCHAR(32)              -- 'no_action' | 'removed' | 'suspended' | 'other'
);
CREATE INDEX reports_open_idx ON reports(created_at DESC) WHERE resolved_at IS NULL;

-- ─── Content warnings ─────────────────────────────────────────
-- Free-text label shown above a fold; viewer clicks to reveal body.
ALTER TABLE posts ADD COLUMN content_warning VARCHAR(140);
