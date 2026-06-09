-- 0027: denormalized counters maintained by DB triggers (100k roadmap, Q5 + M1).
--
-- Two hot counts move from per-request/per-mutation COUNT(*) to trigger-maintained
-- columns. Triggers (not app code) are used deliberately: they are atomic, fire on
-- *every* path that mutates the source rows (account delete cascade, block→unfollow,
-- ON CONFLICT, …), and therefore cannot drift — the property the app-side
-- fire-and-forget updates lacked.
--
--   * users.followers_count / following_count — the profile previously ran
--     COUNT(*) over `follows` JOIN `users` on every view; for a 500k-follower
--     account that scans 500k rows per profile load (Q5).
--   * posts.reactions_count — previously a full SELECT COUNT(*) recount on every
--     react/unreact, i.e. O(reactions) per reaction → O(n²) over a viral post's
--     life (M1). The column already existed; only its maintenance changes.
--
-- NOTE on followers/following: this counts raw follow rows. The old query also
-- filtered `u.role <> 'suspended'`; a denormalized counter can't track a follower's
-- live suspension state without a users.role trigger, so a suspended follower now
-- still counts — an accepted small skew (roadmap Q5). posts_count and replies_count
-- (soft-delete/moderation-aware predicates) are intentionally left for a separate,
-- carefully-scoped change.

ALTER TABLE users ADD COLUMN IF NOT EXISTS followers_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INTEGER NOT NULL DEFAULT 0;

-- follows → users.followers_count / following_count
CREATE OR REPLACE FUNCTION trg_follows_counts() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.followee_id;
        UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.followee_id;
        UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS follows_counts_trg ON follows;
CREATE TRIGGER follows_counts_trg
    AFTER INSERT OR DELETE ON follows
    FOR EACH ROW EXECUTE FUNCTION trg_follows_counts();

-- reactions → posts.reactions_count (replaces the app-side full recount).
-- ON CONFLICT DO UPDATE on a re-react fires UPDATE (not INSERT), so the count
-- only moves on a genuinely new/removed reaction — exactly the old semantics.
CREATE OR REPLACE FUNCTION trg_reactions_count() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE posts SET reactions_count = reactions_count + 1 WHERE id = NEW.post_id;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE posts SET reactions_count = GREATEST(reactions_count - 1, 0) WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reactions_count_trg ON reactions;
CREATE TRIGGER reactions_count_trg
    AFTER INSERT OR DELETE ON reactions
    FOR EACH ROW EXECUTE FUNCTION trg_reactions_count();

-- Backfill to the exact current counts (idempotent — safe to re-run on deploy).
UPDATE users u SET
    followers_count = (SELECT COUNT(*) FROM follows WHERE followee_id = u.id),
    following_count = (SELECT COUNT(*) FROM follows WHERE follower_id = u.id);

UPDATE posts p SET reactions_count = (SELECT COUNT(*) FROM reactions WHERE post_id = p.id);
