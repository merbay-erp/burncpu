-- Deterministic, non-production identity used only by the isolated load-test DB.
WITH load_user AS (
    INSERT INTO users (id, email, username, display_name)
    VALUES (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'load-test@invalid.example',
        'load_test',
        'Load Test'
    )
    ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id
)
INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
SELECT
    id,
    decode('3fb73f988d87b1f1ba6dac08891770040ff1c1bc8e57fbd36470bfb368bb7594', 'hex'),
    NOW() + INTERVAL '1 day',
    'burncpu-load-test'
FROM load_user
ON CONFLICT (token_hash) DO UPDATE
SET user_id = EXCLUDED.user_id,
    expires_at = EXCLUDED.expires_at,
    revoked_at = NULL,
    last_seen_ua = EXCLUDED.user_agent;
