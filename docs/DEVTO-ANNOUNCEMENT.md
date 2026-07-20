---
title: "burncpu: Building a One-VPS Social Network After Losing My Mastodon Account"
published: false
description: "The story behind a self-hosted, open-source social platform built so anyone can run a community of their own."
tags: rust, solidjs, reactnative, opensource
cover_image: https://burncpu.com/og-card.png
---

🇹🇷 [Türkçe sürüm](https://github.com/merbay-erp/burncpu/blob/main/docs/DEVTO-ANNOUNCEMENT.tr.md)

**Live demo:** [burncpu.com](https://burncpu.com)<br>
**Source:** [github.com/merbay-erp/burncpu](https://github.com/merbay-erp/burncpu)

![burncpu — one VPS is enough](https://burncpu.com/og-card.png)

## The story behind burncpu

This project started with a quiet, unsettling moment: my Mastodon account was
closed without warning.

I am not writing this to litigate one platform's decision. Every service has
moderation boundaries, and every community needs rules. What stayed with me was
the feeling of losing the ability to understand, host and appeal the system
around my own social identity. The posts, connections and context were suddenly
somewhere I could no longer control.

That experience made one question impossible to ignore: if social media is where
our communities and work live, why can't more of us own the place where it runs?

**burncpu is my answer.** It is an open-source blueprint for a social network
that one person can run on one VPS. A small team can turn the same foundation
into a sector-specific network for makers, researchers, educators, local
communities or any group that needs its own rules, identity and moderation model.

The point is not to build another attention machine. The point is to make
publishing and community ownership possible for more people.

## Freedom has to be operational

For me, freedom is not only a slogan in a README. It means being able to inspect
the request path, export and delete an account, understand why moderation acted,
appeal a decision, and move the service to infrastructure I control. That is why
the core is self-hosted, the code is MIT-licensed, the moderation path is
auditable, and the one-VPS constraint is treated as a feature rather than an
embarrassment.

That is the idea behind **burncpu**: a deliberately compact social platform for
people who still think before posting. The tagline is simple: **one VPS is
enough**.

This is not a claim that one server can replace every distributed system. It is
a design constraint that keeps the system understandable, affordable and
operable by one person.

## The architecture is intentionally boring

```text
Cloudflare
    │ TLS, WAF and edge protection
nginx
    │ security headers + reverse proxy
Rust/Axum
    ├── PostgreSQL 16  (source of truth)
    ├── Redis 7        (rate limits, sessions, ephemeral state)
    └── Meilisearch    (public search)
```

The API is one Rust binary. The production container listens on `3050` and is
published only to the VPS loopback interface; nginx is the only public origin
entry point. Migrations run forward on startup. There is no Kubernetes cluster,
service mesh or message broker to operate.

The core is self-hosted on the VPS. Cloudflare, SMTP and optional OAuth
providers are explicit integration boundaries, not hidden dependencies in the
data path.

## What users can actually do

- Sign in with a one-shot magic link, passkey or optional OAuth provider.
- Write sanitized Markdown posts, replies and reposts.
- Follow people and hashtags, search public posts, and browse trending topics.
- Send mutual-follow direct messages with image/video attachments, reactions,
  read receipts and typing indicators.
- Upload images and short videos with EXIF stripping, size limits and a bounded
  transcode path.
- Subscribe to Web Push or native APNs/FCM device notifications.
- Follow ActivityPub actors and discover federated posts when federation is
  enabled by the operator.
- Export or delete an account, revoke sessions, use 2FA and manage passkeys.

Moderation is part of the design, not an afterthought. Explainable signals
(account trust, link/domain reputation, denylist and toxicity hints, account
heat and report thresholds) can quarantine, shadow-ban or suspend content and
accounts. Decisions remain reversible and auditable; appeals are first-class.

## Security boundaries I wanted to be able to explain

The application is passwordless by default. Session cookies are `HttpOnly`,
`Secure` and `SameSite=Lax`; magic-link tokens are short-lived, one-shot and
stored only as hashes. Admin routes require both the admin role and a
2FA-satisfied session. Passkeys are a first factor, never a way around TOTP.

User-authored Markdown is rendered and sanitized server-side. Link previews use
an IP-pinned, redirect-checked, byte-capped HTTP client so the server is not an
open proxy. Uploads are sniffed, re-encoded and bounded. SQL uses parameterized
queries. Every request has an `x-request-id`, and security-sensitive paths are
redacted in the audit log.

The web bundle does not call Google Fonts. Geist, Geist Mono and Material
Symbols are pinned OFL-1.1 Fontsource packages, emitted as same-origin WOFF2
assets, preloaded where useful and checked during the build. The production CSP
allows `font-src 'self' data:` only.

## Tests that protect the boring parts

The repository has more than a compile check:

- 47 Rust tests, formatting and Clippy with warnings denied.
- Web Vitest regression tests and 28 Playwright flows across desktop and a
  mobile viewport.
- Expo web Playwright flows across Android and iOS-sized viewports.
- Maestro flows for native Android and iOS, executed by EAS workflows on
  managed devices.
- Dependency audits, license/source policy, gitleaks and production builds in
  GitHub Actions.
- A guarded concurrent runner that holds authenticated notification SSE
  connections while exercising health, timeline, search and sitemap HTTP
  paths.

The pull-request load profile is **1,000 SSE connections + 2,000 HTTP
requests**. A weekly/manual isolated soak profile is **10,000 SSE + 10,000
HTTP requests** for 60 seconds. The runner refuses `burncpu.com` and other
production domains by design; production is not a load-test target.

## The trade-offs are visible

burncpu is not pretending to be a hyperscale platform. It has one VPS, one
admin role and no media CDN. Learned ML moderation is intentionally not a
requirement; the current moderation layer is explainable heuristics plus human
appeals. Native device E2E needs the EAS device environment, while browser E2E
runs locally and in GitHub Actions.

Those constraints are useful. They make failure modes easier to inspect, keep
the monthly bill legible, and make it possible to read the whole request path
before changing it.

## Run it locally

```bash
git clone https://github.com/merbay-erp/burncpu.git
cd burncpu
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d --wait
cargo run --release
```

In a second terminal:

```bash
cd web
npm ci
npm run dev
```

The full setup and environment reference are in the repository's
[README](https://github.com/merbay-erp/burncpu/blob/main/README.md),
[configuration guide](https://github.com/merbay-erp/burncpu/blob/main/docs/CONFIGURATION.md),
[API reference](https://github.com/merbay-erp/burncpu/blob/main/docs/API.md) and
[deployment runbook](https://github.com/merbay-erp/burncpu/blob/main/docs/DEPLOYMENT.md).

The application code is MIT-licensed. The `burncpu` name, logo and mascot are
brand assets with separate rights; please do not assume the brand license from
the code license.

If you build something with the same “small, legible and high-signal” goal, I
would love to hear what you kept simple and what you deliberately left out.
