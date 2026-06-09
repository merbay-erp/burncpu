-- 0037: account-level appeals (100k roadmap, item 4). Extends the post-only
-- appeals table (0031) to also cover account suspensions, since a suspended user
-- can't authenticate to use the in-app post-appeal flow — they appeal out-of-band
-- (an unauthenticated email-identified endpoint), an admin reviews, and granting
-- un-suspends the account.

ALTER TABLE appeals
    ADD COLUMN IF NOT EXISTS target_kind VARCHAR(16) NOT NULL DEFAULT 'post'
    CHECK (target_kind IN ('post', 'account'));

-- post_id is required for post appeals, absent for account appeals.
ALTER TABLE appeals ALTER COLUMN post_id DROP NOT NULL;
ALTER TABLE appeals ADD CONSTRAINT appeals_target_ck CHECK (
    (target_kind = 'post' AND post_id IS NOT NULL)
    OR (target_kind = 'account' AND post_id IS NULL)
);

-- One open account appeal per appellant (the post dedupe index in 0031 only covers
-- post appeals — its (appellant_id, post_id) key treats NULL post_ids as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS appeals_account_dedupe
    ON appeals (appellant_id) WHERE status = 'open' AND target_kind = 'account';
