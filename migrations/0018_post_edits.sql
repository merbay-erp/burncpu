-- Post edit history. Each row is a prior version of a post's body, snapshotted
-- at the moment it was replaced. The post row itself always holds the latest
-- body; post_edits accumulates everything that came before, newest last.
-- (posts.edited_at already marks "this post has been edited".)

CREATE TABLE post_edits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    body_html   TEXT NOT NULL,
    edited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- when this version was superseded
);

CREATE INDEX post_edits_post_idx ON post_edits(post_id, edited_at DESC);
