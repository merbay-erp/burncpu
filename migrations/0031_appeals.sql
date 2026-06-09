-- 0031: moderation appeals (100k roadmap, Phase 3 / P6).
--
-- The human counterweight to autonomous moderation: an author whose post was
-- quarantined or removed (by the spam scorer, the report threshold, or an admin)
-- can appeal it. The appeal lands in an admin queue; granting restores the post
-- to 'live' (and reindexes it), denying just closes the appeal. Every decision is
-- written to moderation_log like any other, so the audit trail is complete.
--
-- Scope: post-level appeals only. Shadow-ban is invisible by design (the author
-- has nothing to appeal), and a suspended account can't authenticate to file one,
-- so account-level appeals need an out-of-band (email) channel — left for later.

CREATE TABLE IF NOT EXISTS appeals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appellant_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    note          TEXT,
    status        VARCHAR(16) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'granted', 'denied')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ,
    resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL
);

-- One open appeal per (appellant, post) — a repeat is an idempotent no-op.
CREATE UNIQUE INDEX IF NOT EXISTS appeals_dedupe_idx
    ON appeals (appellant_id, post_id) WHERE status = 'open';
-- Admin queue: newest open appeals first.
CREATE INDEX IF NOT EXISTS appeals_open_idx
    ON appeals (created_at DESC) WHERE status = 'open';
