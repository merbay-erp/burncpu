-- Direct-message parity with the rest of the app: attachments (image/video)
-- and per-message reactions. Read/sent status already lives on dm_messages
-- (read_at / created_at); the clients just needed the data below to render
-- media, reactions, and richer message management.

-- ── Attachments ────────────────────────────────────────────────────────────
-- A message carries at most one media item. Once a message can be media-only,
-- `body` may be empty, so loosen the length check to allow that case.
ALTER TABLE dm_messages ADD COLUMN media_url  text;
ALTER TABLE dm_messages ADD COLUMN media_kind varchar(8); -- 'image' | 'video'

ALTER TABLE dm_messages DROP CONSTRAINT dm_messages_body_check;
ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_body_check
    CHECK (char_length(body) <= 5000
           AND (char_length(body) >= 1 OR media_url IS NOT NULL));

-- ── Per-message reactions ──────────────────────────────────────────────────
-- One emoji per user per message (upsert to change it), mirroring post
-- reactions. Same small allowlist is enforced in the handler.
CREATE TABLE dm_reactions (
    message_id uuid        NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    emoji      text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX dm_reactions_message_idx ON dm_reactions (message_id);
