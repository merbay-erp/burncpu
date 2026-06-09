-- 0030: shadow-ban — a stealth moderation tier (100k roadmap, Phase 3 / P4).
--
-- A shadow-banned account keeps posting and sees its own content as normal, but
-- that content is hidden from everyone else. Implemented as a new post
-- moderation_state, 'shadow', rather than a viewer-aware predicate sprinkled
-- across every read path: the ~30 existing `moderation_state = 'live'` filters
-- (timeline, search, rss, sitemap, embed, federation, trending, …) already
-- EXCLUDE anything that isn't 'live', so shadow content is hidden from all of
-- them for free, with zero changes and therefore zero leak surface. Only the
-- handful of *viewer-aware* queries (a logged-in user's own timeline/feed/
-- profile/permalink/replies) gain an `OR (moderation_state = 'shadow' AND
-- author_id = viewer)` so the shadow-banned author still sees their own posts —
-- the stealthiness that stops ban-evasion. Missing one of those is at worst a
-- cosmetic stealth gap, never a content leak.
--
-- users.shadow_banned records who is shadow-banned, so create_post can stamp new
-- posts 'shadow' and shadow_ban/unshadow_ban can flip the existing ones in bulk.

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_moderation_state_check;
ALTER TABLE posts ADD CONSTRAINT posts_moderation_state_check
    CHECK (moderation_state IN ('live', 'quarantine', 'removed', 'shadow'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS shadow_banned BOOLEAN NOT NULL DEFAULT false;
