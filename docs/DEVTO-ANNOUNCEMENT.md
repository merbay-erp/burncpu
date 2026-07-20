---
title: "I Lost My Mastodon Account. Then I Built My Own Social Network."
published: false
description: "How a sudden account closure became burncpu: an open-source, self-hosted social network designed to fit on one VPS."
tags: rust, solidjs, reactnative, opensource
cover_image: https://burncpu.com/devto-cover-v2.png
---

[🇹🇷 Türkçe sürüm](https://github.com/merbay-erp/burncpu/blob/main/docs/DEVTO-ANNOUNCEMENT.tr.md) · [Live demo](https://burncpu.com) · [Source](https://github.com/merbay-erp/burncpu)

![burncpu — an exit from the grid](https://burncpu.com/devto-cover-v2.png)

> I didn't want another feed. I wanted an exit.

*burncpu began as a personal response to losing access to a social identity — and
became an open-source blueprint for communities that want to own where they meet.*

| | |
| --- | --- |
| **The idea** | Social publishing should be possible without surrendering the whole system. |
| **The shape** | A complete social platform that one person can run on one VPS. |
| **The invitation** | Fork it for your community, your sector and your rules. |

## 01 — The moment that started it

This project began with a quiet, unsettling moment: my Mastodon account was
closed without warning.

This is not an attempt to litigate one platform's decision. Every service has
moderation boundaries, and every community needs rules. What stayed with me was
the feeling of losing the ability to understand, host and appeal the system
around my own social identity. The posts, connections and context were suddenly
somewhere I could no longer control.

That experience made one question impossible to ignore:

> If our communities and our work live on social media, why can't more of us own the place where they run?

**burncpu is my answer.** It is a self-hosted, open-source social network that
one person can run on one VPS. A small team can use the same foundation to build
a focused network for makers, researchers, educators, professional groups,
neighbourhoods or any community that needs its own identity and moderation model.

The goal is not another attention machine. The goal is to make publishing and
community ownership feel possible again.

## 02 — Freedom has to be operational

For me, freedom is not a slogan in a README. It is a set of ordinary abilities:

- inspect the request path and the trust boundaries;
- export, delete and move your account data;
- understand why moderation acted and appeal a decision; and
- run the service on infrastructure you control.

That is why burncpu keeps its core self-hosted, releases the application code
under the MIT license, records moderation decisions and treats the one-VPS
constraint as a feature rather than an embarrassment.

> **The promise:** the system should be small enough to understand, strong enough to trust and open enough to make your own.

## 03 — One foundation, many communities

The same foundation can serve very different communities without forcing them
into one global feed. Imagine a network for:

- independent makers and small product teams;
- researchers who want a focused, low-noise discussion space;
- teachers, students and local learning communities;
- professional associations with their own moderation rules; or
- a neighbourhood, event or organisation that wants to own its social layer.

The important part is not the logo or the default colour palette. It is the
ability to fork the rules, run the service and decide what “healthy conversation”
means for the people who use it.

## 04 — The one-VPS design bet

“One VPS is enough” is an engineering constraint, not a claim that every system
should stay small forever. It keeps the first deployment legible:

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

Cloudflare, SMTP and optional OAuth providers are explicit integration
boundaries, not hidden dependencies in the data path. The centre of gravity
stays on the VPS.

## 05 — What people can actually do

- Sign in with a one-shot magic link, passkey or optional OAuth provider.
- Write sanitised Markdown posts, replies and reposts.
- Follow people and hashtags, search public posts and browse trends.
- Send mutual-follow direct messages with image/video attachments, reactions,
  read receipts and typing indicators.
- Upload media with EXIF stripping, size limits and a bounded transcode path.
- Subscribe to Web Push or native APNs/FCM notifications.
- Follow ActivityPub actors and discover federated posts when enabled by the
  operator.
- Export or delete an account, revoke sessions, use 2FA and manage passkeys.

Moderation is part of the design, not an afterthought. Explainable signals —
account trust, link/domain reputation, denylists, toxicity hints, account heat
and report thresholds — can quarantine, shadow-ban or suspend content and
accounts. Decisions remain reversible and auditable; appeals are first-class.

## 06 — Trust is a feature

The application is passwordless by default. Session cookies are `HttpOnly`,
`Secure` and `SameSite=Lax`; magic-link tokens are short-lived, one-shot and
stored only as hashes. Admin routes require both the admin role and a
2FA-satisfied session. Passkeys are a first factor, never a way around TOTP.

User-authored Markdown is rendered and sanitised server-side. Link previews use
an IP-pinned, redirect-checked, byte-capped client so the server is not an open
proxy. Uploads are sniffed, re-encoded and bounded. SQL uses parameterised
queries. Every request has an `x-request-id`, and security-sensitive paths are
redacted in the audit log.

The web bundle does not call Google Fonts. Geist, Geist Mono and Material
Symbols are pinned OFL-1.1 Fontsource packages, emitted as same-origin WOFF2
assets, preloaded where useful and checked during the build. The production CSP
allows `font-src 'self' data:` only.

## 07 — Proving the boring parts

The project is measured by more than a successful compile:

- 47 Rust tests, formatting and Clippy with warnings denied;
- Web Vitest regression tests and 28 Playwright flows across desktop and mobile
  viewports;
- Expo web Playwright flows for Android- and iOS-sized viewports;
- Maestro flows for native Android and iOS, executed by EAS workflows on
  managed devices;
- dependency audits, license/source policy, gitleaks and production builds in
  GitHub Actions; and
- a guarded runner that holds authenticated notification SSE connections while
  exercising health, timeline, search and sitemap HTTP paths.

The pull-request profile is **1,000 SSE connections + 2,000 HTTP requests**.
The isolated soak profile is **10,000 SSE + 10,000 HTTP requests** for 60
seconds. The runner refuses `burncpu.com` and other production domains by
design; production is never a load-test target.

## 08 — Trade-offs, deliberately visible

burncpu is not pretending to be a hyperscale platform. It has one VPS, one
admin role and no media CDN. Learned ML moderation is not a requirement; the
current moderation layer is explainable heuristics plus human appeals. Native
device E2E needs the EAS device environment, while browser E2E runs locally and
in GitHub Actions.

Those constraints make failure modes easier to inspect, keep the monthly bill
legible and let one person read the whole request path before changing it.

## 09 — Run it, fork it, make it yours

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
would love to hear what you keep simple — and what you deliberately leave out.

That is the real invitation: not to join one more platform, but to build the
kind of social space you wish already existed.
