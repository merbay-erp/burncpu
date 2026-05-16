-- 0005 — media uploads + bookmarks + post edits

-- ─── Media library (stand-alone — not tied to a post yet) ───
-- post_media already exists from 0001 for attaching to posts after upload.
-- This new `media` table tracks every uploaded blob with owner + content
-- hash so we can deduplicate and enforce per-user quotas.
CREATE TABLE media (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sha256         BYTEA NOT NULL,
    kind           VARCHAR(16) NOT NULL CHECK (kind IN ('image')),
    mime_type      VARCHAR(64) NOT NULL,
    width          INTEGER,
    height         INTEGER,
    size_bytes     BIGINT NOT NULL,
    filename       TEXT NOT NULL,   -- stored basename in media dir
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, sha256)
);
CREATE INDEX media_owner_idx ON media(owner_id, created_at DESC);

-- ─── Bookmarks ───────────────────────────────────────────────
-- Private, per-user, no notification fired. Saves a post for later.
CREATE TABLE bookmarks (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id        UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX bookmarks_user_idx ON bookmarks(user_id, created_at DESC);

-- ─── Post edits ──────────────────────────────────────────────
-- Marks when a post was last edited. UI shows "edited" badge if set.
ALTER TABLE posts ADD COLUMN edited_at TIMESTAMPTZ;
