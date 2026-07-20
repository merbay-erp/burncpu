# burncpu — 100k / production-readiness audit

> Historical audit snapshot. The detailed Turkish record is
> [AUDIT-100K.tr.md](AUDIT-100K.tr.md); this English page is the maintained
> public summary. Status refreshed: 2026-07-20.

## Scope

The review covered the Rust/Axum API, SolidJS web client, Expo mobile client,
Docker/VPS operations, authentication, media, ActivityPub federation,
moderation, observability, backups and the high-concurrency load harness.

## Current disposition

The previously identified release blockers are closed or explicitly bounded:

- Rust formatting, tests, clippy, RustSec/license checks and secret scanning are
  enforced in CI.
- Web and mobile audit/build/lint checks plus browser E2E run in CI. Native
  Maestro/EAS flows are configured for device-capable runners.
- The 1k SSE/2k HTTP pull-request gate and 10k SSE/10k HTTP scheduled soak run
  against isolated local production builds. They never target burncpu.com.
- Authentication includes magic links, WebAuthn passkeys, optional OAuth/PKCE,
  session rotation and admin TOTP. Cookie, CSRF, SSRF, upload and content
  sanitisation boundaries are documented in the threat model.
- Same-origin WOFF2 fonts are self-hosted and checked for preload/license and
  third-party font leakage.

## Accepted boundaries

This is a one-VPS deployment. Cloudflare, SMTP and configured OAuth providers
remain external boundaries; media CDN, learned ML moderation and multi-admin
RBAC are not promised. Production load testing is intentionally prohibited by
the harness. Nightly backups and restore runbooks exist, but off-site backup
retention remains an operational responsibility.

For the live engineering contract see [ARCHITECTURE.md](../ARCHITECTURE.md),
[THREAT_MODEL.md](../THREAT_MODEL.md) and [docs/LOAD_TESTING.md](LOAD_TESTING.md).
