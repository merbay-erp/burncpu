-- 0033: posts_count (per-user) + replies_count (per-post) maintained by trigger
-- (100k roadmap — finishes the Q5 profile denormalization and the M1 reply count).
--
-- The profile ran COUNT(*) over `posts` on every view (a per-view scan of an
-- author's whole history — 500k rows for a prolific account), and replies_count
-- was bumped fire-and-forget by create_post with no decrement, so it drifted up as
-- replies were deleted or moderated. Both move to ONE trigger on `posts` that
-- compares the OLD vs NEW "counts?" predicate, so every transition — insert,
-- soft-delete (deleted_at), moderation_state change (the spam / shadow / admin
-- flows), visibility change, hard delete — adjusts the right counter atomically and
-- can't drift.
--
--   * users.posts_count   — live, public, non-deleted posts (matches the old profile
--     COUNT predicate; replies are included, as before).
--   * posts.replies_count — live, non-deleted direct replies to a post (replaces the
--     app-side increment; quarantined/shadow replies no longer inflate it).

ALTER TABLE users ADD COLUMN IF NOT EXISTS posts_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION trg_post_counts() RETURNS trigger AS $$
DECLARE
    old_authored boolean := false;
    new_authored boolean := false;
    old_reply    boolean := false;
    new_reply    boolean := false;
BEGIN
    -- Skip UPDATEs that touch none of the predicate columns (e.g. a reactions_count
    -- or replies_count bump). This also stops the parent-row UPDATE below from
    -- re-entering the trigger with any real work to do. OLD/NEW are read only inside
    -- the UPDATE branch, never on INSERT/DELETE.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
           AND OLD.moderation_state = NEW.moderation_state
           AND OLD.visibility = NEW.visibility
           AND OLD.reply_to_id IS NOT DISTINCT FROM NEW.reply_to_id THEN
            RETURN NULL;
        END IF;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        old_authored := OLD.deleted_at IS NULL AND OLD.moderation_state = 'live' AND OLD.visibility = 'public';
        old_reply    := OLD.reply_to_id IS NOT NULL AND OLD.deleted_at IS NULL AND OLD.moderation_state = 'live';
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_authored := NEW.deleted_at IS NULL AND NEW.moderation_state = 'live' AND NEW.visibility = 'public';
        new_reply    := NEW.reply_to_id IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.moderation_state = 'live';
    END IF;

    -- per-author posts_count
    IF new_authored AND NOT old_authored THEN
        UPDATE users SET posts_count = posts_count + 1 WHERE id = NEW.author_id;
    ELSIF old_authored AND NOT new_authored THEN
        UPDATE users SET posts_count = GREATEST(posts_count - 1, 0) WHERE id = OLD.author_id;
    END IF;

    -- per-parent replies_count
    IF new_reply AND NOT old_reply THEN
        UPDATE posts SET replies_count = replies_count + 1 WHERE id = NEW.reply_to_id;
    ELSIF old_reply AND NOT new_reply THEN
        UPDATE posts SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = OLD.reply_to_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_counts_trg ON posts;
CREATE TRIGGER post_counts_trg
    AFTER INSERT OR UPDATE OR DELETE ON posts
    FOR EACH ROW EXECUTE FUNCTION trg_post_counts();

-- Backfill (idempotent; also corrects any existing replies_count drift).
UPDATE users u SET posts_count = (
    SELECT COUNT(*) FROM posts p
    WHERE p.author_id = u.id AND p.deleted_at IS NULL
      AND p.moderation_state = 'live' AND p.visibility = 'public'
);
UPDATE posts p SET replies_count = (
    SELECT COUNT(*) FROM posts c
    WHERE c.reply_to_id = p.id AND c.deleted_at IS NULL AND c.moderation_state = 'live'
);
