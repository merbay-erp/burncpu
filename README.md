<div align="center">

# 🔥 burncpu

**One VPS is enough.** A small, high-signal social space for people who still
think before posting.

[![Deploy](https://github.com/merbay-erp/burncpu/actions/workflows/deploy.yml/badge.svg)](https://github.com/merbay-erp/burncpu/actions/workflows/deploy.yml)
[![Security](https://github.com/merbay-erp/burncpu/actions/workflows/security.yml/badge.svg)](https://github.com/merbay-erp/burncpu/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-edition_2024-orange.svg)](Cargo.toml)
[![SolidJS](https://img.shields.io/badge/solidjs-1.9-2c4f7c.svg)](web/)

🌐 **[burncpu.com](https://burncpu.com)** · 🐢 [Mustafa Erbay](https://mustafaerbay.com.tr) · 📜 MIT · 📚 [Docs](https://burncpu.com/docs) · 🇹🇷 [Türkçe](README.tr.md)

</div>

---

> **Built for humans who still think before posting.**
> Low ego. High signal. Internet for people who build things.

## Why burncpu?

burncpu deliberately runs on one VPS: one Rust binary, one Postgres, one Redis,
one Meilisearch instance and an in-process event bus. There is no Kubernetes,
microservice maze or mandatory SaaS dependency. The core stays self-hosted;
Cloudflare, SMTP and explicitly enabled OAuth providers are visible integration
boundaries.

The goal is not maximum volume. It is a small, readable place for real people
to publish useful thoughts without AI engagement farming.

## Highlights

- Passwordless magic links and phishing-resistant WebAuthn passkeys; optional
  Google, GitHub and Microsoft OAuth with PKCE.
- Markdown posts rendered after server-side XSS sanitisation, threaded replies,
  reposts, bookmarks, trash/restore and account export.
- Follow-based and global feeds, typo-tolerant Meilisearch, trends, hashtags,
  SSE notifications and real-time direct messages with media and reactions.
- Layered, reversible moderation: spam and toxicity signals, domain reputation,
  account heat, report thresholds, quarantine, shadow-ban, suspension and
  human appeals. Decisions are auditable in `moderation_log`.
- ActivityPub federation, RSS/Atom, scoped API tokens, web push and a PWA.
- React Native / Expo mobile client with native push, universal links and an EAS
  iOS build workflow.
- Operational guardrails: health checks, audit trails, nightly Postgres backup,
  web/mobile browser E2E, Maestro/EAS flows, 1k/2k and 10k/10k load gates, and
  same-origin self-hosted WOFF2 fonts verified in CI.

## Stack

| Layer | Technology |
|---|---|
| Backend | Rust 2024, Axum 0.8, tokio, tower-http |
| Database | PostgreSQL 16 via sqlx 0.8 |
| Cache / limits | Redis 7 |
| Search | Meilisearch 1.10 |
| Web | SolidJS 1.9, TypeScript 5.7, Vite 6, Tailwind 3.4 |
| Mobile | React Native, Expo SDK 56, expo-router |
| Auth / crypto | magic link, OAuth2/PKCE, WebAuthn, TOTP, Argon2, XChaCha20-Poly1305 |
| Edge | Cloudflare → nginx → host loopback `127.0.0.1:3060` → app container `:3050` |

## Quick start

Requirements: Rust 2024, Node.js 20+ (CI also verifies Node 24.3), PostgreSQL
16, Redis 7 and Meilisearch 1.10. Docker Compose can provide the local services.

```bash
git clone https://github.com/merbay-erp/burncpu.git
cd burncpu
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d --wait
cargo run --release
curl localhost:3050/healthz
```

Run the web client in a second shell:

```bash
cd web
npm ci
npm run dev                 # http://localhost:5173
```

The development proxy targets the live API by design. Use a disposable account
when testing state-changing flows. See [web/README.md](web/README.md),
[mobile/README.md](mobile/README.md) and [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
for client and environment details.

## Repository map

```text
src/             Rust/Axum backend, routes, middleware and federation
migrations/      SQL migrations 0001 → 0040
web/              SolidJS frontend
mobile/           React Native / Expo client
static/           PWA metadata and security association files
.github/workflows CI, security, load and deploy gates
docs/             API, operations, audits and the Dev.to draft
```

## Documentation

Every public guide has an English canonical page and a Turkish translation:

The complete bilingual index is [docs/README.md](docs/README.md).

- [Architecture](ARCHITECTURE.md) · [Türkçe](ARCHITECTURE.tr.md)
- [Contributing](CONTRIBUTING.md) · [Türkçe](CONTRIBUTING.tr.md)
- [Code of Conduct](CODE_OF_CONDUCT.md) · [Türkçe](CODE_OF_CONDUCT.tr.md)
- [Security policy](SECURITY.md) · [Türkçe](SECURITY.tr.md)
- [Threat model](THREAT_MODEL.md) · [Türkçe](THREAT_MODEL.tr.md)
- [API reference](docs/API.md) · [Türkçe](docs/API.tr.md)
- [Configuration](docs/CONFIGURATION.md) · [Türkçe](docs/CONFIGURATION.tr.md)
- [Deployment runbook](docs/DEPLOYMENT.md) · [Türkçe](docs/DEPLOYMENT.tr.md)
- [Load testing](docs/LOAD_TESTING.md) · [Türkçe](docs/LOAD_TESTING.tr.md)
- [Performance plan](docs/PERF-LCP-PLAN.md) · [Türkçe](docs/PERF-LCP-PLAN.tr.md)
- [Dev.to article draft](docs/DEVTO-ANNOUNCEMENT.md) · [Türkçe](docs/DEVTO-ANNOUNCEMENT.tr.md)
- [Web client](web/README.md) · [Türkçe](web/README.tr.md)
- [Mobile client](mobile/README.md) · [Türkçe](mobile/README.tr.md)

Historical audit records keep their original date and language, with a matching
translation beside each file: [audit index](docs/AUDIT-2026-07-14.md).

## Development and verification

```bash
cargo fmt --all -- --check
cargo test --all-targets --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
(cd web && npm ci && npm test && npm run build)
(cd mobile && npm ci && npx tsc --noEmit && npm run lint)
```

Browser E2E, native Maestro/EAS flows and the high-concurrency load gate are
documented in [CONTRIBUTING.md](CONTRIBUTING.md). The load gate is intentionally
isolated and refuses to target production.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md), follow the
[Code of Conduct](CODE_OF_CONDUCT.md), and report vulnerabilities through
[SECURITY.md](SECURITY.md), never through a public issue.

## License

The code is released under the [MIT License](LICENSE). The burncpu name, logo
and visual identity remain the author's brand; see
[web/THIRD-PARTY-NOTICES.md](web/THIRD-PARTY-NOTICES.md) for bundled assets.
