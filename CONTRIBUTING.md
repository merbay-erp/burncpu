# Contributing to burncpu

Thanks for helping build burncpu. 🐢 This guide covers the local toolchain,
coding standards, verification and pull-request process. [Türkçe](CONTRIBUTING.tr.md)

> **TL;DR:** `cargo fmt --all -- --check`, locked Rust tests and clippy, web
> audit/test/build, mobile typecheck/lint and the relevant E2E/load gates must
> pass. Keep commits small and verify UI changes in light, dark and mobile views.

## Development environment

| Tool | Version |
|---|---|
| Rust | current `rustup`, edition 2024 |
| Node.js | 20+ (CI: 24.3) |
| PostgreSQL | 16 |
| Redis | 7 |
| Meilisearch | 1.10 |

Docker Compose can run the local data services. The backend applies migrations
on startup.

## Run locally

```bash
cp .env.example .env       # DATABASE_URL is the only strict boot requirement
docker compose -f docker-compose.dev.yml up -d --wait
cargo run                  # use --release for a production-like build
curl localhost:3050/healthz

cd web
npm ci
npm run dev                # http://localhost:5173
```

The web development proxy sends `/api` requests to `https://burncpu.com`; use a
disposable account for state-changing tests. The mobile client and environment
variables are documented in [web/README.md](web/README.md),
[mobile/README.md](mobile/README.md) and [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Code standards

- Format Rust with `cargo fmt`; clippy must pass with
  `cargo clippy --all-targets --all-features --locked -- -D warnings`.
- Use sqlx bind parameters for every query. Never interpolate SQL strings.
- Keep handlers thin, return `Result<T, AppError>`, and do not expose internals.
- Move indexing, fan-out and mail delivery off the request path with Tokio tasks.
- TypeScript must pass `npx tsc -b` and `npm run build`; do not leave unused
  imports (`noUnusedLocals` is enabled).
- Use Tailwind tokens rather than hard-coded colors. Add every new UI string to
  `i18n.ts` in both `tr` and `en`.
- Prefer existing primitives (`Post`, `Avatar`, `Skeleton`, `AuthGate`,
  `LinkCard`, `InfiniteList`) over duplicate components.
- Keep one PR focused on one change; comments should explain why, not restate
  what the code already says.

## Verification

```bash
cargo fmt --all -- --check
cargo test --all-targets --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
(cd web && npm ci && npm audit --audit-level=high && npm test && npm run build)
(cd web && npx playwright install chromium webkit && npm run test:e2e)
(cd mobile && npm ci && npm audit --audit-level=high && npx tsc --noEmit && npm run lint && npm run test:e2e)
```

For backend/load changes, run the isolated high-concurrency gate described in
[docs/LOAD_TESTING.md](docs/LOAD_TESTING.md). It refuses production URLs.

For UI changes, check light and dark themes, a ~390px viewport, keyboard/focus
behavior and a clean browser console.

## Commits and pull requests

Use an imperative subject of roughly 72 characters, explain *why* in the body,
and separate unrelated changes. Branch from `main`:

```bash
git switch -c codex/short-descriptive-name
```

Open a PR using [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)
and include the commands you ran. CI must be green: security (RustSec,
licenses, gitleaks), format/test/clippy, web/mobile audit-build-lint, browser
E2E and the load gate when applicable. Merging to `main` triggers the self-hosted
production deploy, so do not push directly to `main`.

## Database migrations

Add a sequential `migrations/00NN_short_name.sql` file for schema changes. Keep
migrations forward-only and idempotent; production has no automatic rollback.

## Security

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md), and use [THREAT_MODEL.md](THREAT_MODEL.md) for the
accepted trust boundaries and risks.
