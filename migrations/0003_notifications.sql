-- burncpu v0.3 — notifications

-- Per-user notification inbox. Append-only; user marks rows read.
-- kind: what happened
--   'reaction'  → someone reacted to your post (target = post)
--   'reply'     → someone replied to your post (target = post = the reply, parent in actor's post)
--   'follow'    → someone followed you (target = user = self)
--   'mention'   → future: @-mention in body (target = post)
--   'mod_action'→ future: admin took action on your content
CREATE TABLE notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          VARCHAR(16) NOT NULL
                  CHECK (kind IN ('reaction', 'reply', 'follow', 'mention', 'mod_action')),
    actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    target_kind   VARCHAR(16) NOT NULL
                  CHECK (target_kind IN ('post', 'user', 'reaction')),
    target_id     UUID NOT NULL,
    metadata      JSONB,
    read_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inbox query: WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
-- Unread badge query: WHERE user_id = $1 AND read_at IS NULL
CREATE INDEX notifications_unread_idx ON notifications(user_id)
    WHERE read_at IS NULL;

-- Self-notifications are noise — drop them at the producer side, but a
-- belt-and-suspenders constraint is cheap:
ALTER TABLE notifications ADD CONSTRAINT notifications_not_self
    CHECK (actor_id IS NULL OR actor_id <> user_id);

COMMENT ON TABLE notifications IS 'Cleanup: DELETE WHERE created_at < now() - interval ''180 days''';
