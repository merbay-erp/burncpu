# burncpu — Mimari

> Parçaların nasıl birleştiğini anlatır. [English](ARCHITECTURE.md) ·
> Son revizyon: 2026-07-20.

## Tasarım özeti

Temel kısıt **tek VPS**: tek Rust binary'si, tek PostgreSQL, işlem-içi SSE
yayın otobüsü ve okuma anında hesaplanan akışlar. Cloudflare → nginx → host
loopback `127.0.0.1:3060` → Axum container `:3050` zinciri kullanılır. Postgres,
Redis ve Meilisearch yalnızca özel Docker ağında çalışır.

## Bileşenler

- **Axum/Rust:** route modülleri, auth extractor, CSRF/rate-limit/audit
  middleware'leri, SSE ve arka plan işleri.
- **Postgres 16:** kalıcı gerçek; sqlx sorguları derleme zamanında kontrol edilir.
- **Redis 7:** rate-limit, oturum yardımcıları ve geçici bildirim durumları.
- **Meilisearch 1.10:** typo toleranslı post/kullanıcı/hashtag araması.
- **SolidJS web + Expo mobil:** aynı API sözleşmesi; webde same-origin WOFF2.
- **Federasyon:** ActivityPub imzaları, WebFinger, NodeInfo ve RSS/Atom.

## Veri akışı

İstek Cloudflare ve nginx güvenlik katmanlarından geçer; Axum oturum, CSRF,
gövde ve rate-limit kontrollerini yapar. Handler Postgres/Redis'e gider, ağır
indeksleme/fan-out/e-posta işlerini Tokio task'ına bırakır. Bildirimler işlem-içi
SSE kanalıyla yayınlanır. Link önizlemeleri SSRF korumalı ve IP-pinned istemci
kullanır; Markdown `ammonia` ile temizlenir.

## Migration ve CI

Migration aralığı `0001 → 0040_remote_metadata_and_video_index` şeklindedir.
Üç workflow vardır: `deploy.yml`, `security.yml` ve `load.yml`. CI; format/test/
clippy, RustSec/lisans/source, gitleaks, web/mobile audit-build-lint, browser
E2E ve izole 1k/2k ile 10k/10k yük profillerini kapı olarak kullanır.

## Güvenlik ve operasyon

Magic-link, WebAuthn passkey, isteğe bağlı OAuth/PKCE ve admin TOTP birlikte
çalışır. Çerezler HttpOnly/Secure/SameSite, state-changing istekler same-origin,
dosyalar yeniden kodlanır ve audit log'a yazılır. Gece Postgres yedeği alınır;
off-site saklama ve kapasite planı host operasyonunun sorumluluğudur.

Detay için [API](docs/API.tr.md), [tehdit modeli](THREAT_MODEL.tr.md) ve
[deploy runbook'u](docs/DEPLOYMENT.tr.md) okuyun.
