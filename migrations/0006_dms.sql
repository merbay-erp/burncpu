-- 0006 — direct messages

-- A thread is between exactly two users. To make lookup symmetric the
-- pair is stored in canonical order (a_id < b_id) and uniqueness is
-- enforced. UI queries by `({me, them})` mapped to canonical form.
CREATE TABLE dm_threads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    a_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (a_id, b_id),
    CHECK (a_id < b_id)
);
CREATE INDEX dm_threads_a_idx ON dm_threads(a_id, last_message_at DESC);
CREATE INDEX dm_threads_b_idx ON dm_threads(b_id, last_message_at DESC);

CREATE TABLE dm_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id    UUID NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
    sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    body_html    TEXT NOT NULL,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);
CREATE INDEX dm_messages_thread_idx ON dm_messages(thread_id, created_at DESC);

-- Per-user pinned post for the profile page (one slot).
ALTER TABLE users ADD COLUMN pinned_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

COMMENT ON TABLE dm_messages IS 'Cleanup: nothing automated — DMs are user-owned';
