# burncpu — Deployment & Operations

🇹🇷 [Türkçe sürüm](DEPLOYMENT.tr.md)

How burncpu ships and how to operate it. Complements
[ARCHITECTURE.md](../ARCHITECTURE.md) and [CONFIGURATION.md](CONFIGURATION.md).

The whole platform runs on **one VPS** ("VPS3") behind Cloudflare. There is no
orchestrator — a single app container plus Postgres, Redis, and Meilisearch on
a private docker network.

## Continuous deployment

Pushing to `main` deploys automatically:

```
git push origin main
   └─ GitHub Actions: "Deploy to VPS3"  (.github/workflows/deploy.yml)
        runs-on: [self-hosted, mustafaerbay]   # runner lives on VPS3
        └─ sudo /usr/local/bin/deploy-burncpu.sh "$GITHUB_WORKSPACE"
             ├─ rsync backend → /opt/burncpu/app
             ├─ build SPA      → /opt/burncpu/web   (nginx root)
             ├─ rebuild app container (migrations run on startup)
             └─ health-gate
        └─ Verify: curl -fsS https://burncpu.com/healthz
```

- **Self-hosted runner.** VPS3's outbound 443 to GitHub is restricted, so a
  self-hosted runner pulls the workspace and runs the deploy. All deploy logic
  lives in a **root-owned, sudoers-allowlisted** script
  (`/usr/local/bin/deploy-burncpu.sh`) — the runner can invoke it but not edit
  it (least privilege).
- **Concurrency.** `group: burncpu-deploy`, `cancel-in-progress: false` — runs
  serialize; a deploy never interrupts another.
- **Timing.** Frontend-only deploys are usually a few minutes; a cold Rust
  dependency rebuild can use the full 60-minute workflow budget. The runner
  health-gates the container and then the public HTTPS path.

### What triggers a deploy

`deploy.yml` filters on `paths`: `src/**`, `web/**`, `Cargo.toml`,
`Cargo.lock`, `Dockerfile`, `migrations/**`, and the workflow itself.
Doc-only changes (README, `docs/**`, …) **do not** redeploy. `workflow_dispatch`
allows a manual run.

### Verifying a deploy

```bash
# 1. Health endpoint is 200
curl -fsS https://burncpu.com/healthz

# 2. The live JS bundle matches your local build (frontend changes)
curl -s https://burncpu.com/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1
ls web/dist/assets | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1
# the two hashes should be identical
```

For a backend change, also sanity-check a route that exercises the new code
(e.g. a new field appears in its JSON response).

## Host layout

```
/opt/burncpu/
├── app/            # backend (rsynced) + docker-compose.yml
├── web/            # built SPA, served by nginx
└── .env            # secrets — chmod 600, root-owned, NEVER in git
```

The container listens on `0.0.0.0:3050`; production Docker publishes that port
only to host loopback as `127.0.0.1:3060`. nginx terminates TLS and proxies to
the loopback mapping; Cloudflare fronts nginx on `:443`. No application or
data port is publicly reachable.

## Secrets

- Live only in `/opt/burncpu/.env` (chmod 600, root-owned).
- `.gitignore` covers `*.env*`; `gitleaks` runs in CI on every push.
- Rotate by editing `.env` and recreating the container:
  `cd /opt/burncpu/app && docker compose up -d --force-recreate`.
- Key secrets: `DATABASE_URL`, `MEILI_MASTER_KEY`, `BURNCPU_ENC_KEY`,
  `SMTP_PASSWORD`, `VAPID_PRIVATE_KEY`. See [CONFIGURATION.md](CONFIGURATION.md).

## Database

- **Migrations** run automatically on app startup (sqlx, ordered files in
  `migrations/`). To add one, drop a new `00NN_*.sql`; never edit a shipped
  migration.
- **Backups** — nightly `pg_dump` (03:00, `/opt/burncpu/scripts/backup.sh`) with
  7-day rotation + monthly snapshots, written to `/opt/burncpu/backups/`.
- **Offsite copy** — the operator's Mac pulls the backup dir daily at 10:00 via
  a LaunchAgent (`com.burncpu.backup-pull` →
  `~/.local/bin/burncpu-backup-pull.sh`, rsync over ssh to
  `~/Backups/burncpu/files/`, local prune >90d). A VPS disk loss no longer
  takes the backups with it.
- **Restore drill** — verified 2026-06-10: latest nightly restored cleanly into
  a throwaway `postgres:16-alpine` container; row counts matched prod modulo
  post-backup activity. Re-run the drill after any major schema change.
- **Postgres tuning** — applied via `ALTER SYSTEM` (persisted to
  `postgresql.auto.conf` in the data volume; survives container recreation). The
  prod box is 18 cores / 94 GB with the burncpu-pg container limited to 24 GB,
  shared with other small DBs. Re-apply these on a fresh DB host (run each as a
  separate statement — `ALTER SYSTEM` can't share a transaction):
  ```sql
  ALTER SYSTEM SET shared_buffers = '8GB';                 -- needs restart
  ALTER SYSTEM SET effective_cache_size = '20GB';
  ALTER SYSTEM SET work_mem = '48MB';
  ALTER SYSTEM SET max_worker_processes = 16;              -- needs restart
  ALTER SYSTEM SET max_parallel_workers = 16;
  ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
  ALTER SYSTEM SET effective_io_concurrency = 200;         -- SSD
  SELECT pg_reload_conf();                                 -- then: docker restart burncpu-pg
  ```
  The app's pool is `DB_MAX_CONNECTIONS` (default 48, under Postgres's 100).
- **Restore (example)**:

  ```bash
  # stop the app so nothing writes mid-restore
  cd /opt/burncpu/app && docker compose stop app
  gunzip -c /path/to/backup-YYYYMMDD.sql.gz | \
    docker compose exec -T postgres psql -U burncpu -d burncpu
  docker compose start app
  ```

## Manual operations

```bash
ssh vps3
cd /opt/burncpu/app

docker compose ps                 # service status
docker compose logs -f app        # tail app logs (JSON tracing)
docker compose up -d              # apply compose changes
docker compose restart app        # bounce the app
docker compose up -d --force-recreate   # after .env change
```

Logs are structured JSON; correlate a request by its `x-request-id`.

## Rolling back

1. `git revert <bad-commit>` (or revert the merge) and push to `main` — the
   normal pipeline redeploys the previous-good state.
2. If a migration is implicated, **do not** delete it; write a forward-fixing
   migration. Postgres has no down-migrations here by design.
3. For an emergency, recreate from the last image/commit on the host and
   restore the latest backup if data is affected.

## CI checks (security.yml)

Runs on every push, every PR, and daily (06:17 UTC):

| Job | Tool | Gate |
|-----|------|------|
| `cargo audit` | RustSec advisory DB | known-vuln crates |
| `cargo deny` | advisories · licenses · bans · sources | supply-chain policy |
| `build-check` | fmt · all-target tests · Clippy `-D warnings` | compile + lint |
| `web-mobile` | npm audit · Vitest · production build · mobile typecheck/lint | client quality + dependency gate |
| `web-mobile-e2e` | Playwright desktop/mobile browser flows | critical UI regressions |
| `secret-scan` | gitleaks | committed secrets |

`load.yml` separately runs the isolated 1k/2k pull-request gate and the
weekly/manual 10k/10k SSE/HTTP soak profile. Its URL guard refuses
`burncpu.com`, so load traffic cannot accidentally target production.

A red `security.yml` should block merge.

## Security headers (nginx)

Security headers are set by **nginx**, not the app (the app's responses are
proxied; the SPA is served statically from `/opt/burncpu/web`). nginx's
`add_header` is **not inherited** into a `location` that defines its own
`add_header`, so the headers live in a snippet that is *also* included into
the SPA `location /`:

```nginx
# /etc/nginx/snippets/burncpu-headers.conf  — included into location /
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), …" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
```

```nginx
location / {
    try_files $uri /index.html;
    add_header Cache-Control "no-cache" always;
    include snippets/burncpu-headers.conf;   # <-- restores the security headers
}
```

### Self-hosted web fonts

The web app does not call Google Fonts at runtime. `@fontsource-variable/geist`,
`@fontsource-variable/geist-mono` and `@fontsource-variable/material-symbols-outlined`
are pinned in `web/package-lock.json`; Vite bundles their OFL-1.1 WOFF2 files
under the application origin. `web/vite.config.ts` adds hashed, same-origin
preload hints for the critical text faces (including Turkish Latin-ext) and Fontsource's CSS keeps
`font-display: swap`. `npm run verify:font-assets` fails the build if a Google URL,
external CSS font URL, missing preload asset or non-swap font declaration appears.

The `font-src 'self' data:` CSP is therefore sufficient; no
`fonts.googleapis.com` or `fonts.gstatic.com` exception is allowed. The live
BurnCPU nginx server and SPA snippet were synchronized to this policy on
2026-07-14 and must be re-checked after any host rebuild.

> ⚠️ **CSP / inline-script coupling.** `web/index.html` has one **inline**
> theme-init script (runs before paint to avoid a theme flash). Under CSP it
> must be allowlisted by hash, so `script-src` carries its SHA-256. **If you
> change that inline script, regenerate the hash** and update the snippet:
>
> ```bash
> # from the built file the server actually serves
> python3 - <<'PY'
> import re, hashlib, base64
> s = re.search(r'<script>(.*?)</script>', open('/opt/burncpu/web/index.html').read(), re.S).group(1)
> print("sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode())
> PY
> ```
>
> Then `nginx -t && systemctl reload nginx`, and verify:
> `curl -sI --resolve burncpu.com:443:127.0.0.1 https://burncpu.com/ | grep -i content-security`.
> The snippet lives outside the repo (host config), so it is **not** redeployed
> by CI — edit it on the host, keep a root-owned backup, run `nginx -t`, reload,
> and verify the public header before closing the change.

## Incident response

See [THREAT_MODEL.md → Incident response](../THREAT_MODEL.md#incident-response)
for the compromise runbook (revoke sessions, rotate secrets, inspect
`audit_log` / `login_attempts`). Report vulnerabilities via
[SECURITY.md](../SECURITY.md).

## Health & observability

- `GET /healthz` — pings Postgres + Redis; `503` when unhealthy. Used by the
  deploy gate and any uptime monitor.
- `tracing` JSON logs; every response carries `x-request-id`.
- Retention jobs (`src/cleanup.rs`) trim `audit_log`, trash, and expired tokens.
