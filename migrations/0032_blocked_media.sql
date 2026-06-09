-- 0032: image hash blocklist (100k roadmap, Phase 3 / P5).
--
-- A free, hash-based image-moderation primitive — no ML classifier (that would be
-- a paid dependency). When an admin removes a post and opts to block its media,
-- the sha256 of each attached image is recorded here; uploads whose content hash
-- matches are then rejected. Because media.sha256 is computed over the *re-encoded*
-- bytes (EXIF/XMP stripped, normalized in media::ingest_image_bytes), a re-upload
-- of a blocked image is caught even if its metadata or container changed.
--
-- Scope: this blocks re-uploads of KNOWN-bad images only. Proactively classifying
-- a never-seen image as NSFW/abusive needs an ML model or a paid hash-matching
-- service (e.g. PhotoDNA), which is out of scope here.

CREATE TABLE IF NOT EXISTS blocked_media_hashes (
    sha256      BYTEA PRIMARY KEY,
    reason      TEXT,
    blocked_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
