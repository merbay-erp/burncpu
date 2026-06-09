-- 0028: account moderation "heat" — a decaying, per-account misbehaviour signal
-- (100k roadmap, Phase 3 / P2: account heat & escalation).
--
-- Each automated quarantine or admin removal of an account's content raises its
-- heat (weights are set at the call sites). Heat decays linearly — 1 point/day —
-- so a reformed account cools back to baseline with no manual intervention and no
-- background job: the decay is computed on read/write from heat_updated_at.
--
-- Two escalation tiers consume it:
--   * create_post feeds current heat into the spam score, so a repeat offender's
--     borderline posts get auto-quarantined — a soft, reversible response;
--   * crossing HEAT_SUSPEND_THRESHOLD auto-suspends the account (actor_kind='ai',
--     reversible by an admin) — the hard tier.
--
-- current_heat() centralises the decay math so the writer (moderation::add_heat)
-- and every reader derive the same value from (heat_score, heat_updated_at).
-- Adding a constant-default column is a metadata-only change in PG (no rewrite),
-- so this is safe on a large users table.

ALTER TABLE users ADD COLUMN IF NOT EXISTS heat_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS heat_updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION current_heat(h INTEGER, updated TIMESTAMPTZ) RETURNS INTEGER AS $$
    SELECT GREATEST(
        h - FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(updated, NOW()))) / 86400)::int,
        0
    );
$$ LANGUAGE sql STABLE;
