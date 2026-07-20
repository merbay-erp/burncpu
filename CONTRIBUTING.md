# Katkı Kılavuzu

burncpu'ya katkıda bulunmak istediğin için teşekkürler. 🐢
Bu doküman geliştirme ortamını, kod standartlarını ve PR sürecini anlatır.

> **TL;DR:** `cargo fmt --all -- --check`, `cargo test --all-targets`,
> `cargo clippy --all-targets --all-features -- -D warnings`, web build/audit
> ve mobile typecheck/lint temiz geçmeli; commit'ler küçük ve odaklı olmalı;
> UI değişikliklerini açık + koyu temada ve mobilde doğrula.

## İçindekiler

- [Davranış kuralları](#davranış-kuralları)
- [Geliştirme ortamı](#geliştirme-ortamı)
- [Çalıştırma](#çalıştırma)
- [Kod standartları](#kod-standartları)
- [Test & doğrulama](#test--doğrulama)
- [Commit kuralları](#commit-kuralları)
- [Pull request süreci](#pull-request-süreci)
- [Veritabanı migration'ları](#veritabanı-migrationları)
- [Güvenlik](#güvenlik)

## Davranış kuralları

Kısa versiyon: **low ego, high signal.** Saygılı ol, somut ol, yapıcı ol.
Taciz, spam ve kötü niyet hoş görülmez. Tam metin →
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Bildirim:
`mustafa@mustafaerbay.com.tr`.

## Geliştirme ortamı

| Araç | Sürüm |
|------|-------|
| Rust | `rustup` güncel (edition 2024) |
| Node.js | 20+ (CI: 24.3) |
| PostgreSQL | 16 |
| Redis | 7 |
| Meilisearch | v1.10 |

Postgres/Redis/Meilisearch'ü lokal kurabilir veya Docker ile kaldırabilirsin.
Backend, açılışta migration'ları otomatik koşar.

## Çalıştırma

```bash
# Backend
cp .env.example .env          # boot için tek zorunlu: DATABASE_URL — bkz. docs/CONFIGURATION.md
cargo run                     # geliştirme (debug). Release için: cargo run --release
curl localhost:3050/healthz

# Frontend (ayrı terminal)
cd web
npm ci
npm run dev                   # http://localhost:5173
```

Frontend dev sunucusu `/api` isteklerini production'a (`burncpu.com`)
proxy'ler — yani backend'i lokalde çalıştırmadan da UI geliştirebilirsin.
Detay: [web/README.md](web/README.md).

## Kod standartları

**Rust**
- `cargo fmt` ile formatla.
- **`cargo clippy --all-targets --all-features --locked -- -D warnings` sıfır
  uyarı ile geçmeli.**
- SQL **her zaman** sqlx parametreli bind kullanır — asla string interpolation.
- Handler'lar ince olsun; `Result<T, AppError>` döndür, internal sızdırma.
- Uzun işleri (indexleme, fanout, e-posta) `tokio::spawn` ile arka plana al.

**TypeScript / SolidJS**
- **`npx tsc -b` ve `npm run build` temiz geçmeli** (`noUnusedLocals` açık —
  kullanılmayan import bırakma).
- Stil için Tailwind + CSS-değişken token'ları
  (`rgb(var(--c-NAME) / <alpha>)`); ham renk kodu gömme.
- Yeni metin → `i18n.ts`'e hem `tr` hem `en` anahtarı ekle.
- Mevcut primitive'leri kullan: `<Post>`, `<Avatar>`, `<Skeleton>`,
  `<AuthGate>`, `<LinkCard>`, `InfiniteList`. Tekerleği yeniden icat etme.

**Genel**
- Küçük, tek-amaçlı değişiklikler. Bir PR = bir konu.
- Yorumlar *niçin*'i anlatsın, *ne*'yi değil.

## Test & doğrulama

```bash
# Backend
cargo fmt --all -- --check
cargo test --all-targets --locked
cargo clippy --all-targets --all-features --locked -- -D warnings

# Frontend
(cd web && npm ci && npm audit --audit-level=high && npm test && npm run build)

# Web browser E2E (desktop + mobile viewport)
(cd web && npx playwright install chromium webkit && npm run test:e2e)

# Mobile (Expo web + Android/iOS viewports)
(cd mobile && npm ci && npm audit --audit-level=high && npx tsc --noEmit && npm run lint && npm run test:e2e)

# High-concurrency gate (after building/running the app on port 3050;
# see docs/LOAD_TESTING.md for the complete isolated command)
docker compose -f docker-compose.dev.yml up -d --wait
docker compose -f docker-compose.dev.yml exec -T postgres \
  psql -U burncpu -d burncpu < load/seed.sql
node load/high-concurrency.mjs
```

**UI değişiklikleri için** — burncpu görsel kaliteye önem verir. Bir UI PR'ı
göndermeden önce:
- Açık **ve** koyu temada test et (`html.light`).
- Mobil genişlikte (≈390px) yatay taşma olmadığını doğrula.
- Konsol hatası olmadığını kontrol et.

## Commit kuralları

- Emir kipinde, açıklayıcı bir özet satırı: `Add command palette (⌘K)`.
- İlk satır ≤ ~72 karakter; gerekiyorsa boş satır + gövde (*niçin*).
- İlgisiz değişiklikleri ayrı commit'lere böl.

Örnek:

```
Fix emoji picker: clipped panel + scroll jump in composers

The popup lived inside an overflow-x-auto toolbar, which clipped the
upward panel and triggered an autofocus scroll. Render it in a Portal
with fixed positioning instead.
```

## Pull request süreci

1. `main`'den bir dal aç: `git switch -c codex/kisa-aciklayici-ad`.
2. Değişikliğini yap; yukarıdaki kontrolleri (clippy/tsc/build) yerel çalıştır.
3. PR aç — şablon ([.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md))
   neyi/niçin değiştirdiğini ve nasıl doğruladığını sorar.
4. CI yeşil olmalı: `security.yml` (RustSec/license/source, fmt/test/clippy,
   gitleaks, web/mobile audit-build-lint ve browser E2E) ve backend/load
   değişikliklerinde `load.yml`.
5. Gözden geçirme sonrası `main`'e merge edilir ve self-hosted runner
   otomatik deploy eder.

> Not: `main`'e push **production'a deploy tetikler**. Doğrudan `main`'e
> push etme; PR üzerinden ilerle.

## Veritabanı migration'ları

- Yeni şema değişikliği → `migrations/` altına sıralı bir dosya ekle
  (`00NN_kisa_ad.sql`). Numarayı atlama.
- Migration'lar **ileri-yönlü ve idempotent** düşünülmeli; üretimde geri alma
  yok — dikkatli yaz.
- Açılışta `cargo run` migration'ları otomatik uygular.

## Güvenlik

Bir güvenlik açığı bulduysan **issue açma**. Sorumlu bildirim için
[SECURITY.md](SECURITY.md)'i izle. Mimari riskler için
[THREAT_MODEL.md](THREAT_MODEL.md).

---

Sorular için issue açabilir veya yazara ulaşabilirsin. İyi kodlamalar. 🔥
