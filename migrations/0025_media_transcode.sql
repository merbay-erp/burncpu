-- Video transcode pipeline state for `media` rows (kind = 'video').
--
-- Uploaded videos are stored verbatim, then a background worker normalises them
-- to a universally-playable H.264/AAC MP4 and extracts a poster frame. This adds
-- the per-row state machine that drives that work and the client's placeholder.
--
--   processing_state:  pending → processing → ready | failed
--   duration_ms:       probed source duration (ms), shown in the player
--   poster_filename:   extracted poster frame (JPEG) in media_dir, or NULL
--   transcoded_filename: normalised MP4 in media_dir; the playable file once ready
--   error:             short failure reason when processing_state = 'failed'
--
-- DEFAULT 'ready' so every existing row (all images, plus videos already stored
-- verbatim) is treated as done and keeps serving its current file untouched —
-- only newly-uploaded videos enter the pipeline at 'pending'.
ALTER TABLE media
    ADD COLUMN IF NOT EXISTS processing_state    text NOT NULL DEFAULT 'ready',
    ADD COLUMN IF NOT EXISTS duration_ms         integer,
    ADD COLUMN IF NOT EXISTS poster_filename     text,
    ADD COLUMN IF NOT EXISTS transcoded_filename text,
    ADD COLUMN IF NOT EXISTS error               text;

-- The worker and the boot-time requeue both scan for unfinished work; keep that
-- a tiny partial index rather than a scan over every image ever uploaded.
CREATE INDEX IF NOT EXISTS media_processing_idx
    ON media (processing_state)
    WHERE processing_state IN ('pending', 'processing');
