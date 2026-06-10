-- 0038: remote-post ingestion store (100k roadmap, item 5 — federation
-- consumption). Until now federation was publish-only: the inbox accepted
-- Follow/Undo and the instance fanned its own posts out, but ignored incoming
-- Create/Announce, so it never *consumed* the network. This table caches remote
-- posts the instance receives (from remote actors that follow a local user, and —
-- once the relay lands — from a subscribed relay's firehose) so they can surface
-- in a federated "explore" timeline. content_html is sanitized at ingest with the
-- same ammonia allowlist as local content (remote <img> are stripped — no SSRF /
-- tracking-pixel loads). hidden is the admin moderation flag; host-blocked actors
-- (federation_blocks) are never ingested in the first place.

CREATE TABLE remote_posts (
    uri           TEXT PRIMARY KEY,            -- the ActivityPub object id (globally unique)
    actor_uri     TEXT NOT NULL,
    actor_handle  TEXT,                        -- @user@host, best-effort
    actor_name    TEXT,
    actor_avatar  TEXT,
    content_html  TEXT NOT NULL,               -- sanitized
    url           TEXT,                        -- canonical web URL of the post
    in_reply_to   TEXT,                        -- parent AP uri, when it's a reply
    published_at  TIMESTAMPTZ NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hidden        BOOLEAN NOT NULL DEFAULT false
);

-- The explore timeline: newest top-level (non-reply), non-hidden posts first.
CREATE INDEX remote_posts_explore_idx
    ON remote_posts (published_at DESC)
    WHERE NOT hidden AND in_reply_to IS NULL;
-- For pruning + per-actor lookups.
CREATE INDEX remote_posts_actor_idx ON remote_posts (actor_uri, published_at DESC);
