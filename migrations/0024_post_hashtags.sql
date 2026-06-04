-- post_hashtags: a materialized `#tag` index for posts.
--
-- The home feed's "followed topics" branch used to test every candidate post
-- body against every tag the viewer follows with a per-row regex
--   lower(p.body) ~ ('(?<![[:alnum:]_])#' || hf.tag || '(?![[:alnum:]_])')
-- which cannot use an index and rescans bodies on every feed page. This table
-- lets that branch become an indexed EXISTS join.
--
-- The app keeps it in sync on create/edit/repost using the SAME boundary
-- semantics, and we backfill existing rows below. Tags are lowercased [a-z0-9_].
CREATE TABLE IF NOT EXISTS post_hashtags (
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag     text NOT NULL,
    PRIMARY KEY (post_id, tag)
);

-- The feed lookup is "given a followed tag, is this post tagged with it" — a
-- tag-keyed probe. The PK is (post_id, tag); add a tag-leading index for the join.
CREATE INDEX IF NOT EXISTS post_hashtags_tag_idx ON post_hashtags (tag);

-- Backfill from existing bodies. Same semantics as the inline lookbehind regex
-- it replaces: a '#' must sit at a word boundary, tag chars are [a-z0-9_], and
-- the leading-boundary group means '#a#b' yields only 'a' (its '#b' is preceded
-- by an alnum, exactly as the old (?<![[:alnum:]_]) lookbehind rejected it).
-- regexp_matches(..., 'g') returns one row per match; group 2 is the tag.
INSERT INTO post_hashtags (post_id, tag)
SELECT p.id, m[2]
FROM posts p
CROSS JOIN LATERAL regexp_matches(lower(p.body), '(^|[^a-z0-9_])#([a-z0-9_]+)', 'g') AS m
WHERE p.body IS NOT NULL
ON CONFLICT (post_id, tag) DO NOTHING;
