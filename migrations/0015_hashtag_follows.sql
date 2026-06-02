-- Follow a topic, not a person: public posts carrying a followed hashtag
-- surface in the follower's personal feed. Tags are stored lowercase, no '#'.

CREATE TABLE hashtag_follows (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag         TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, tag)
);
CREATE INDEX hashtag_follows_tag_idx ON hashtag_follows(tag);
