# burncpu — Dev.to tanıtım taslağı

[English draft](DEVTO-ANNOUNCEMENT.md) · Bu dosya doğrudan Dev.to'ya yapıştırılabilir
Türkçe sürümdür; front matter'da `published: false` bırakılmıştır.

## Tek VPS ile yüksek sinyalli sosyal alan

burncpu, Rust/Axum API, SolidJS web ve Expo mobil istemcisini tek VPS üzerinde
çalıştıran MIT lisanslı açık kaynak bir sosyal platformdur. Amaç trafik rekoru
değil; gerçek insanların düşünerek yazdığı, okunabilir ve denetlenebilir bir
alan kurmaktır.

## Öne çıkanlar

Şifresiz magic-link, WebAuthn passkey ve isteğe bağlı OAuth/PKCE; thread/repost/
bookmark/trash; Meilisearch arama; SSE bildirimleri; medya ve reaksiyonlu DM;
ActivityPub/RSS; native push ve universal link desteği bulunur. Spam, toksisite,
domain itibarı, rapor eşiği ve hesap ısısı katmanları quarantine → shadow-ban →
askıya alma akışını üretir; kararlar audit edilir ve itiraz edilebilir.

## Operasyon ve güvenlik

Cloudflare → nginx → loopback `:3060` → Axum container `:3050` zinciri vardır.
Postgres/Redis/Meilisearch private Docker ağındadır. CI format/test/clippy,
güvenlik/lisans/secret taraması, web/mobile audit-build-lint, browser E2E,
Maestro/EAS akışları ve 1k/2k ile 10k/10k yük gate'lerini çalıştırır. Web fontları
same-origin WOFF2 olarak self-host edilir; Google Fonts yokluğu build'de doğrulanır.

## Sınırlar

Yük testi üretime uygulanmaz. Media CDN, öğrenilmiş ML moderasyonu ve multi-admin
RBAC kapsam dışıdır. Cloudflare, SMTP ve etkin OAuth sağlayıcıları açıkça dış
entegrasyon sınırlarıdır.
