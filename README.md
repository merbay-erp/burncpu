<div align="center">

# 🔥 burncpu

**1 VPS yeter.** Düşünerek paylaşan insanlar için, küçük ama yüksek-sinyalli bir sosyal alan.

[![Deploy](https://github.com/merbay-erp/burncpu/actions/workflows/deploy.yml/badge.svg)](https://github.com/merbay-erp/burncpu/actions/workflows/deploy.yml)
[![Security](https://github.com/merbay-erp/burncpu/actions/workflows/security.yml/badge.svg)](https://github.com/merbay-erp/burncpu/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-edition_2024-orange.svg)](Cargo.toml)
[![SolidJS](https://img.shields.io/badge/solidjs-1.9-2c4f7c.svg)](web/)

🌐 **[burncpu.com](https://burncpu.com)** · 🐢 [Mustafa Erbay](https://mustafaerbay.com.tr) · 📜 MIT (kod) · 📚 [Dokümanlar](https://burncpu.com/docs)

</div>

---

> **Built for humans who still think before posting.**
> Low ego. High signal. Internet for people who build things.

## Manifesto

**1 VPS yeter.**

k8s yok. Microservice yok. "Serverless" yok. Tek bir sunucu, doğru ölçü,
ölçülebilir kaynak. Bu sadece bir infra tercihi değil — bir engineering
yaklaşımı, anti-bloat bir tavır, anti-corporate bir his.

İnternet hızla AI içerikle doluyor: AI tweet, AI reply, AI engagement
farming. Bizim hedefimiz tam tersi: **gerçek insanların yazdığı, düşünerek
paylaşılan, küçük ama yüksek-sinyalli bir alan.** Az kişi, çok değer.

## İçindekiler

- [Özellikler](#özellikler)
- [Stack](#stack)
- [Mimari prensipler](#mimari-prensipler)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Proje yapısı](#proje-yapısı)
- [API](#api)
- [Dokümanlar](#dokümanlar)
- [Yol haritası](#yol-haritası)
- [Katkı](#katkı)
- [Güvenlik](#güvenlik)
- [Lisans](#lisans)

## Özellikler

**Hesap & kimlik**
- 🔑 Şifresiz **magic-link** auth (15 dk TTL, tek kullanımlık, IP+email rate-limit)
- 🛡️ Admin için **TOTP 2FA** (RFC 6238, recovery kodları, XChaCha20-Poly1305 ile şifreli saklanan secret)
- ✉️ Davet kodu ile kayıt (5/gün, 14 gün TTL)
- 📤 Hesap verisi dışa aktarma (`/users/me/export`)

**İçerik & sosyal**
- ✍️ Markdown post + sunucu tarafı **XSS sanitizasyonu** (ammonia)
- 🔁 Repost, threadli yanıtlar (max derinlik), 🔖 yer imleri, 🗑️ çöp kutusu + geri yükleme
- 🐢 Tek-emoji tepki (animasyonlu)
- 👥 Follow grafiği, kişiye özel akış (Bana Özel) + global akış
- 🔗 **Open Graph link önizlemeleri** (SSRF-korumalı, IP-pinned fetch)
- 🖼️ Görsel yükleme (EXIF temizleme + yeniden kodlama)
- 🔇 Engelleme / sessize alma, 🚩 raporlama + dedupe

**Keşif & gerçek-zamanlı**
- 🔎 **Meilisearch** ile typo-toleranslı arama + hashtag sayfaları
- 📈 Trending (hashtag + post, 1s/24s/7g pencereleri)
- 🔔 SSE ile canlı bildirimler + akışta "yeni sinyal" balonu
- 💬 Karşılıklı-takip DM'leri (yazıyor göstergesi)
- ⌘ **Komut paleti** (⌘K): anında gezinme + kişi/post araması

**Federasyon & dağıtım**
- 🌐 **ActivityPub** (RSA-SHA256 HTTP Signatures, WebFinger, NodeInfo)
- 📡 RSS/Atom feed'ler (global / kullanıcı / hashtag)
- 🪝 Webhook'lar + scope'lu **API token**'ları
- 📱 Web Push (VAPID), PWA kabuğu

**Operasyon**
- 🩺 `/healthz` liveness/readiness (Postgres + Redis ping)
- 📝 Audit log + login_attempts, `x-request-id` izlenebilirliği
- 🌙 Gece yarısı Postgres yedekleri (7 gün rotasyon)
- 🚀 Push-to-`main` ile self-hosted CI deploy (backend + frontend + migrations)

## Stack

| Katman | Teknoloji |
|--------|-----------|
| **Backend** | Rust (edition 2024) · [Axum](https://github.com/tokio-rs/axum) 0.8 · tokio · tower-http |
| **Veritabanı** | PostgreSQL 16 (sqlx 0.8, derleme-zamanı kontrollü sorgular, UUID PK, JSONB) |
| **Cache / rate-limit** | Redis 7 |
| **Arama** | Meilisearch v1.10 |
| **Frontend** | [SolidJS](https://www.solidjs.com/) 1.9 · TypeScript 5.7 · Vite 6 · Tailwind 3.4 |
| **Auth / kripto** | magic-link · TOTP (totp-rs) · XChaCha20-Poly1305 · Argon2 · RSA (HTTP Signatures) |
| **İçerik** | pulldown-cmark (markdown) · ammonia (sanitize) · image (medya) |
| **E-posta** | lettre (async SMTP) |
| **Edge** | Cloudflare (WAF/DDoS) → nginx (TLS) → Axum (127.0.0.1) |

Çalışma-zamanı bağımlılıkları **tamamen VPS'te**: harici SaaS yok.

## Mimari prensipler

1. **1 VPS yeter** — doğru ölçü, dikkatli mühendislik
2. **No third-party auth** — magic-link, şifre yok, OAuth çöplüğü yok
3. **Spam-resistant by design** — moderasyon bir pazarlama değil, mimari karar
4. **Tek dil per katman** — backend: Rust, frontend: TypeScript
5. **Self-hosted** — tüm bağımlılıklar tek sunucuda, harici servis yok
6. **Defense in depth** — SSRF guard, sanitize, rate-limit, audit, 2FA gate

Detaylar için → **[ARCHITECTURE.md](ARCHITECTURE.md)**

## Hızlı başlangıç

### Önkoşullar

- Rust (edition 2024 / `rustup` güncel), Node.js 20+
- PostgreSQL 16, Redis 7, Meilisearch v1.10 (lokal veya Docker)

### Backend

```bash
git clone https://github.com/merbay-erp/burncpu.git
cd burncpu
cp .env.example .env
# .env'i doldur: DATABASE_URL, REDIS_URL, SITE_ORIGIN, MEILI_* ...

cargo run --release            # migration'lar açılışta otomatik koşar
curl localhost:3050/healthz    # {"status":"ok",...}
```

### Frontend

```bash
cd web
npm install
npm run dev                    # http://localhost:5173
# vite dev sunucusu /api isteklerini burncpu.com'a proxy'ler (web/vite.config.ts)
```

Frontend ayrıntıları → **[web/README.md](web/README.md)**

### Production (Docker)

```bash
ssh vps3 'cd /opt/burncpu && docker compose up -d'
curl https://burncpu.com/healthz
```

Deploy `main`'e push ile otomatiktir (self-hosted runner). Bkz.
[ARCHITECTURE.md → Deployment](ARCHITECTURE.md#deployment--ci).

## Proje yapısı

```
burncpu/
├── src/                    # Rust/Axum backend
│   ├── main.rs             # router montajı + katmanlar (layers)
│   ├── routes/             # her API kaynağı bir modül (posts, dm, auth, ...)
│   ├── middleware/         # auth extractor, rate-limit, audit, gövde limiti
│   ├── auth/               # magic-link, session, 2FA
│   ├── content/            # markdown render + sanitize
│   ├── federation/         # ActivityPub (signatures, fanout, webfinger)
│   ├── search/             # Meilisearch indeksleme + sorgu
│   ├── net_safety.rs       # SSRF-güvenli HTTP client
│   └── state.rs            # paylaşılan AppState + SSE broadcast
├── migrations/             # sqlx SQL migration'ları (0001 → 0012)
├── web/                    # SolidJS frontend
│   └── src/{pages,components,...}
├── static/                 # PWA manifest, ikonlar, robots
├── .github/workflows/      # deploy.yml + security.yml
├── ARCHITECTURE.md · CONTRIBUTING.md · THREAT_MODEL.md · SECURITY.md
└── docs/API.md             # tam endpoint referansı
```

## API

Tüm uç noktalar `/api/v1` altında. Tam referans → **[docs/API.md](docs/API.md)**.

| Alan | Örnek uçlar |
|------|-------------|
| **Auth** | `POST /auth/request` · `POST /auth/logout` · `POST /auth/2fa/*` |
| **Posts** | `GET\|POST /posts` · `GET\|DELETE /posts/{id}` · `POST\|DELETE /posts/{id}/react` · `GET /posts/{id}/thread` · `POST /posts/{id}/repost` |
| **Users** | `GET /users/{u}` · `PATCH /users/me` · `POST\|DELETE /users/{u}/follow` · `GET /users/lookup` · `GET /users/me/export` |
| **Feed / keşif** | `GET /feed` · `GET /search?q=` · `GET /hashtags/{tag}` · `GET /trending/{posts,hashtags}` |
| **Sosyal** | `GET\|POST /bookmarks` · `POST /dm/threads/{u}` · `POST /users/{u}/{block,mute}` · `POST /reports` |
| **Gerçek-zamanlı** | `GET /notifications/stream` (SSE) · `GET /notifications` |
| **Geliştirici** | `GET\|POST /tokens` · `GET\|POST /webhooks` · `POST /push/subscribe` |
| **Federasyon** | `/.well-known/webfinger` · `/nodeinfo/2.1` · `/ap/*` · `/rss/*` |

## Dokümanlar

| Doküman | İçerik |
|---------|--------|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Sistem tasarımı, istek yaşam döngüsü, veri modeli, frontend mimarisi, gerçek-zamanlı, deploy/CI |
| **[docs/API.md](docs/API.md)** | Tam endpoint referansı (auth, gövde, yanıt) |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | Geliştirme akışı, kod standartları, commit & PR kuralları |
| **[web/README.md](web/README.md)** | Frontend stack, dev server, theming, i18n |
| **[THREAT_MODEL.md](THREAT_MODEL.md)** | STRIDE tehdit modeli, güven sınırları, kabul edilen riskler |
| **[SECURITY.md](SECURITY.md)** | Güvenlik açığı bildirimi |
| **[CHANGELOG.md](CHANGELOG.md)** | Sürüm geçmişi |

## Yol haritası

✅ **Tamamlandı**
- Magic-link auth + audit + session hijack flag + **TOTP 2FA**
- Post CRUD (markdown + XSS sanitize), repost, threadli yanıtlar, çöp kutusu
- Tepkiler, profiller, follow grafiği, kişiye özel + global akış
- Davet-only kayıt, admin moderasyon paneli (post/user/audit/session/mod_log)
- Meilisearch arama + hashtag sayfaları + trending
- **SolidJS frontend** (PWA kabuğu, açık/koyu Ember teması, i18n TR/EN)
- Bildirimler + **SSE canlı akış** + "yeni sinyal" balonu
- **DM'ler** (karşılıklı-takip, yazıyor göstergesi)
- Link önizlemeleri (SSRF-korumalı), görsel yükleme (EXIF strip)
- Komut paleti (⌘K), avatar cropper, taslak kaydetme
- RSS/Atom, **ActivityPub** federasyon (signatures/webfinger/nodeinfo)
- Web Push (VAPID), webhook'lar, scope'lu API token'ları
- SMTP gerçek gönderim, gece yedekleri (7 gün rotasyon)

🔜 **Sırada**
- Spam-resistant filtering engine (model-agnostik, çok katmanlı)
- Federation kültürü: relay/keşif politikaları
- Mobil uygulama kabuğu derinleştirme

## Katkı

Katkılar memnuniyetle. Lütfen önce **[CONTRIBUTING.md](CONTRIBUTING.md)**'i
okuyun — geliştirme kurulumu, kod standartları (`cargo clippy -D warnings`,
`tsc`, no-warning policy), commit & PR kuralları orada.

## Güvenlik

Bir güvenlik açığı bulduysan GitHub issue **açma** — sorumlu bildirim için
[SECURITY.md](SECURITY.md)'i izle. Sistem güven sınırları ve kabul edilen
riskler için [THREAT_MODEL.md](THREAT_MODEL.md).

## Lisans

[MIT](LICENSE) — fork edin, ticari kullanın, türetin. Tek kısıt: brand
assets (logo, 🐢 ME mascot, "burncpu" adı) ayrı haklara tabidir.
