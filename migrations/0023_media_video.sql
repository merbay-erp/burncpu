-- Allow video attachments next to images. Videos are stored verbatim (no
-- decode/transcode) and served as static files — nginx already answers range
-- requests, so seeking works in the players.
ALTER TABLE media DROP CONSTRAINT media_kind_check;
ALTER TABLE media ADD CONSTRAINT media_kind_check CHECK (kind::text IN ('image', 'video'));
