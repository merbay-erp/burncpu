-- Encrypt webhook signing secrets at rest (XChaCha20-Poly1305 under
-- BURNCPU_ENC_KEY), matching how TOTP secrets and federation actor private
-- keys are already stored. The plaintext `secret` column is removed.
--
-- The signing secret is shown to the owner exactly once at creation and cannot
-- be re-derived, so existing rows can't be migrated in place. Production has no
-- webhooks; any dev/staging rows are dropped and must be re-created.

ALTER TABLE webhooks ADD COLUMN secret_encrypted BYTEA;
ALTER TABLE webhooks ADD COLUMN secret_nonce     BYTEA;

-- No row has an encrypted secret yet → clears all pre-existing webhooks.
DELETE FROM webhooks WHERE secret_encrypted IS NULL;

ALTER TABLE webhooks DROP COLUMN secret;
ALTER TABLE webhooks ALTER COLUMN secret_encrypted SET NOT NULL;
ALTER TABLE webhooks ALTER COLUMN secret_nonce     SET NOT NULL;
