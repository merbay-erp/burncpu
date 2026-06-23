-- 0040: close two read-path gaps from the audit.
--
-- 1) Remote posts already had actor_name / actor_avatar columns, but ingestion
--    only stored a weak @host handle. Backfill from the cached actor JSON.
-- 2) The video discovery tab regex-scanned post bodies. Maintain a boolean flag
--    on writes and give the hot read path a partial index.

ALTER TABLE posts
    ADD COLUMN has_video BOOLEAN NOT NULL DEFAULT false;

UPDATE posts
SET has_video = body ~* '/media/[a-z0-9._-]+\.(mp4|webm|mov)';

CREATE INDEX posts_video_feed_idx
    ON posts (created_at DESC, id DESC)
    WHERE has_video
      AND deleted_at IS NULL
      AND moderation_state = 'live'
      AND visibility = 'public';

WITH actor_meta AS (
    SELECT
        uri,
        CASE
            WHEN trim(username) <> '' AND trim(host) <> ''
                THEN '@' || left(trim(username), 80) || '@' || trim(host)
            WHEN trim(host) <> '' THEN '@' || trim(host)
            ELSE NULL
        END AS handle,
        NULLIF(left(trim(actor_json->>'name'), 120), '') AS display_name,
        CASE
            WHEN jsonb_typeof(actor_json->'icon') = 'object'
                THEN actor_json#>>'{icon,url}'
            WHEN jsonb_typeof(actor_json->'icon') = 'array'
                THEN actor_json#>>'{icon,0,url}'
            ELSE NULL
        END AS avatar_raw
    FROM federation_actors
)
UPDATE remote_posts rp
SET
    actor_handle = COALESCE(actor_meta.handle, rp.actor_handle),
    actor_name = COALESCE(actor_meta.display_name, rp.actor_name),
    actor_avatar = COALESCE(
        CASE
            WHEN actor_meta.avatar_raw ~* '^https://[^[:space:]<>"]+$'
                THEN actor_meta.avatar_raw
            ELSE NULL
        END,
        rp.actor_avatar
    )
FROM actor_meta
WHERE actor_meta.uri = rp.actor_uri;
