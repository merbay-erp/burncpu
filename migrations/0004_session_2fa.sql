-- 0004 — session 2FA state
-- A session row's `pending_2fa` is set to true at magic-link verification
-- when the user has confirmed TOTP. Admin endpoints refuse to serve a
-- session that still has it true. The /auth/2fa/challenge endpoint clears
-- it once a valid code is presented.

ALTER TABLE sessions
    ADD COLUMN pending_2fa BOOLEAN NOT NULL DEFAULT false;

-- Partial index — sessions in the 2FA-pending state should be a tiny
-- subset, so a partial index keeps it cheap.
CREATE INDEX sessions_pending_2fa_idx ON sessions(user_id)
    WHERE pending_2fa = true;
