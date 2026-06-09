-- 0026: scale indexes (100k roadmap, Phase 2 / Q2 + M2).
--
-- Two classes of missing index that degrade at scale:
--   1. The public-timeline keyset query filters `reply_to_id IS NULL` and tie-breaks
--      on `id`, neither of which the existing `posts_timeline_idx` covers — so it
--      scans index entries for replies (the majority of rows) and filters them out,
--      and the sort isn't fully index-ordered.
--   2. Several foreign keys have no leading index, so a parent-row DELETE/UPDATE-of-key
--      seq-scans the child table, and several also appear in hot WHERE/EXISTS clauses.
--
-- All partial (`WHERE … IS NOT NULL` / the timeline predicate) to stay small.
-- Non-concurrent is fine here: applied while the table is tiny. At large scale a
-- future index should be added with CREATE INDEX CONCURRENTLY outside a migration.

CREATE INDEX IF NOT EXISTS posts_public_timeline_idx
    ON posts (created_at DESC, id DESC)
    WHERE moderation_state = 'live'
      AND deleted_at IS NULL
      AND visibility = 'public'
      AND reply_to_id IS NULL;

CREATE INDEX IF NOT EXISTS posts_repost_of_idx
    ON posts (repost_of_id) WHERE repost_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_actor_idx
    ON notifications (actor_id) WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reports_resolved_by_idx
    ON reports (resolved_by) WHERE resolved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS invites_redeemed_by_idx
    ON invites (redeemed_by) WHERE redeemed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_invited_by_idx
    ON users (invited_by) WHERE invited_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_pinned_post_idx
    ON users (pinned_post_id) WHERE pinned_post_id IS NOT NULL;
