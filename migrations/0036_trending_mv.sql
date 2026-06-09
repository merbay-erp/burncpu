-- 0036: materialized views for the 24h trending surfaces (100k roadmap).
--
-- trending/{hashtags,posts} for the default 24h window were computed at read time
-- — the hashtag view regex-scans every public post in the window on each cache
-- miss. At scale that scan is expensive; precompute it into a materialized view
-- refreshed hourly by crate::cleanup (REFRESH ... CONCURRENTLY, which needs the
-- unique indexes below and never blocks readers). The handler reads the small MV
-- for the 24h window and falls back to the live query for other windows.
--
-- The same P8 anti-gaming applies inside the views: hashtags rank by DISTINCT
-- authors (>= 2) and exclude heated accounts; trending posts require an aged,
-- un-heated author. NOW() is evaluated at refresh time, so the window slides each
-- hour. Author fields are a snapshot (refreshed hourly) — fine for discovery.

CREATE MATERIALIZED VIEW trending_hashtags_24h AS
SELECT tag, COUNT(DISTINCT author_id)::bigint AS count
FROM (
    SELECT p.author_id,
           unnest(regexp_matches(lower(body), '(?<![[:alnum:]_])#([a-z0-9_]{2,32})', 'g')) AS tag
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.deleted_at IS NULL
      AND p.moderation_state = 'live'
      AND p.visibility = 'public'
      AND p.created_at > NOW() - interval '24 hours'
      AND u.role <> 'suspended'
      AND current_heat(u.heat_score, u.heat_updated_at) < 4
) m
GROUP BY tag
HAVING COUNT(DISTINCT author_id) >= 2;

CREATE UNIQUE INDEX trending_hashtags_24h_tag ON trending_hashtags_24h(tag);

CREATE MATERIALIZED VIEW trending_posts_24h AS
SELECT p.id, p.author_id, u.username AS author_username,
       u.display_name AS author_display_name, u.avatar_url AS author_avatar_url,
       p.body, p.body_html, p.reactions_count, p.replies_count, p.created_at,
       (p.reactions_count + p.replies_count) AS score
FROM posts p
JOIN users u ON u.id = p.author_id
WHERE p.deleted_at IS NULL
  AND p.moderation_state = 'live'
  AND p.visibility = 'public'
  AND p.created_at > NOW() - interval '24 hours'
  AND u.role <> 'suspended'
  AND u.created_at < NOW() - interval '48 hours'
  AND current_heat(u.heat_score, u.heat_updated_at) < 4
ORDER BY (p.reactions_count + p.replies_count) DESC, p.created_at DESC
LIMIT 100;

CREATE UNIQUE INDEX trending_posts_24h_id ON trending_posts_24h(id);
