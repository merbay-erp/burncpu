# burncpu — Configuration

🇹🇷 [Türkçe sürüm](CONFIGURATION.tr.md)

All runtime configuration comes from **environment variables**. Locally,
`cargo run` loads a project-root `.env` (via `dotenvy`); in production systemd
provides them through `EnvironmentFile=/opt/burncpu/.env`.

Start from [`.env.example`](../.env.example). The only variable strictly
required to boot is `DATABASE_URL`; admin 2FA additionally needs
`BURNCPU_ENC_KEY`. Everything else has a default or is feature-gated.

Booleans accept `1` / `true` / `yes` / `on` (case-insensitive); anything else
is false.

## Core

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `DATABASE_URL` | ✅ | — | Postgres connection string. |
| `BIND_ADDR` | | `127.0.0.1:3050` | Address the HTTP server binds to. |
| `REDIS_URL` | | `redis://127.0.0.1:6380` | Redis for rate-limits + ephemeral lookups. |
| `SITE_ORIGIN` | | `https://burncpu.com` | Canonical origin (links, CORS, cookie scope). |
| `RUST_LOG` | | — | `tracing` filter, e.g. `burncpu=debug,tower_http=info`. |
| `DB_MAX_CONNECTIONS` | | `48` | Maximum Postgres pool size. Keep below the database/container budget. |

## Search

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `MEILISEARCH_URL` | | `http://127.0.0.1:7700` | Meilisearch endpoint. |
| `MEILI_MASTER_KEY` | | empty | Master key. Falls back to `MEILISEARCH_KEY`. Empty = keyless dev instance. |

## Crypto & accounts

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `BURNCPU_ENC_KEY` | for 2FA | — | 32-byte key as **64 hex chars**. Encrypts stored TOTP secrets. Generate: `openssl rand -hex 32`. |
| `INVITES_REQUIRED` | | `false` | Require an invite code to sign up. |
| `BOOTSTRAP_ADMIN_EMAIL` | | — | Email auto-promoted to admin on first sign-in. |
| `ALLOWED_ORIGINS` | | — | Comma-separated trusted browser origins accepted by the CSRF guard in addition to `SITE_ORIGIN`. This does not enable cross-origin browser API access. |
| `IOS_APP_ID` | | — | Apple Team ID + bundle ID (for example `TEAMID.com.burncpu.app`) used by the universal-link association file. Unset keeps the route disabled. |
| `ANDROID_CERT_FINGERPRINTS` | | — | Comma-separated SHA-256 signing fingerprints for Android app links. Unset keeps the route disabled. |

The public API is intentionally same-origin for browser clients and does not
emit CORS response headers. Native clients are not subject to browser CORS. If
third-party browser clients are supported later, add a strict allowlisted CORS
layer and preflight tests; do not use a wildcard with credentialed requests.

## Media

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `MEDIA_DIR` | | `/data/media` | Writable directory for uploaded images and videos. |
| `MEDIA_USER_QUOTA_BYTES` | | `2147483648` | Per-user stored-media quota (raw incoming size is counted conservatively). |
| `VIDEO_TRANSCODE_ENABLED` | | `true` | Queue uploaded videos for H.264/AAC MP4 normalization and poster extraction. |
| `TRANSCODE_MAX_DURATION_SECS` | | `120` | Reject source videos longer than this before/while transcoding. |

## Spam & moderation

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `SPAM_THRESHOLD` | | `4` | Spam score at/above which a top-level public post is quarantined (lands in the admin review queue). Lower = stricter. |
| `SPAM_DENYLIST` | | — | Comma-separated phrases that strongly flag a post as spam (case-insensitive substring match). |
| `TOXICITY_DENYLIST` | | — | Comma-separated phrases used by the explainable toxicity/harassment heuristic. |
| `REPORT_QUARANTINE_THRESHOLD` | | `4` | Distinct open reports that automatically quarantine a target. |
| `SHADOW_BAN_THRESHOLD` | | `8` | Account heat at which autonomous shadow-ban escalation begins; `0` disables it. |
| `HEAT_SUSPEND_THRESHOLD` | | `12` | Account heat at which autonomous suspension escalation begins; `0` disables the hard tier. |

## Email

The sender picks a backend from `EMAIL_BACKEND`:

- **unset / anything but `smtp`** → *console* backend. Magic links are written
  to the `tracing` logs only — ideal for local dev, no SMTP needed.
- **`smtp`** → real delivery; the `SMTP_*` variables become required.

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `EMAIL_BACKEND` | | console | `smtp` to send real mail; otherwise console. **Refused** for an https `SITE_ORIGIN` unless `ALLOW_CONSOLE_EMAIL` is set. |
| `ALLOW_CONSOLE_EMAIL` | | `false` | Override the production fail-closed and permit the console backend on an https origin (staging only). |
| `SMTP_HOST` | with smtp | — | SMTP server host. |
| `SMTP_PORT` | | `587` | SMTP port. |
| `SMTP_USERNAME` | with smtp | — | SMTP auth user. |
| `SMTP_PASSWORD` | with smtp | — | SMTP auth password. |
| `SMTP_FROM` | with smtp | — | From mailbox, e.g. `burncpu <hi@burncpu.com>`. |
| `SMTP_STARTTLS` | | `true` | `false`/`0`/`no`/`off` → implicit TLS (port 465). |

## Web Push (optional)

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `VAPID_PUBLIC_KEY` | for push | — | VAPID public key. |
| `VAPID_PRIVATE_KEY` | for push | — | VAPID private key. |
| `VAPID_SUBJECT` | | `mailto:hi@burncpu.com` | VAPID subject (mailto/URL). |

## Federation (optional)

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `FEDERATION_ENABLED` | | `false` | Enable ActivityPub server-to-server. |

## OAuth social login (optional)

Each provider is enabled only when both credentials are present. OAuth uses
authorization-code + PKCE, a short-lived state value and verified-email
matching. Do not put these secrets in the repository.

| Variables | Provider |
|-----------|----------|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Microsoft |

## Minimal local setup

```env
DATABASE_URL=postgres://burncpu:dev@127.0.0.1:5433/burncpu
# REDIS_URL / MEILISEARCH_URL use defaults; EMAIL_BACKEND unset = console.
# Add BURNCPU_ENC_KEY (openssl rand -hex 32) if you want to test admin 2FA.
```

That's enough to boot, post, search, and read magic links from the logs.
