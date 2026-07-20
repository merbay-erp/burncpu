# burncpu — Tehdit modeli

> Canlı doküman; özellikler geldikçe güncellenir. [English](THREAT_MODEL.md) ·
> Son revizyon: 2026-07-20.

## Kapsam ve güven sınırları

Kapsamda `burncpu.com`, Cloudflare/WAF, TLS sonlandıran nginx, container portu
`3050` (hostta yalnız `127.0.0.1:3060`), Postgres 16, Redis 7, Meilisearch 1.10,
ActivityPub, SMTP ve sezgisel spam moderasyonu vardır. Media CDN, çoklu-admin
RBAC ve öğrenilmiş ML sınıflandırması mevcut kapsamda değildir.

## Aktörler

Anonim ziyaretçi okur ve magic-link ister; oturumlu kullanıcı kendi içeriğini
değiştirir; admin moderasyon yapar; dış saldırgan ağ üzerinden credential/spam/
DoS dener; gelecekteki insider SSH erişimine sahip olabilir.

## Savunma katmanları

- Magic-link tek kullanımlık/TTL'li; passkey phishing-resistant; OAuth PKCE ve
  state ile; admin TOTP secret'ı şifreli saklanır.
- Session rotation, HttpOnly/Secure/SameSite çerez, same-origin CSRF, rate-limit
  ve UA/IP değişim uyarısı birlikte kullanılır.
- Markdown sanitizasyonu, SSRF için private-IP/DNS rebinding engeli, upload MIME/
  boyut sınırı, EXIF temizliği, yeniden kodlama ve içerik hash blocklist vardır.
- Spam, domain itibarı, toksisite, rapor eşiği ve hesap ısısı; quarantine,
  shadow-ban ve askıya alma şeklinde geri alınabilir eskalasyon üretir.
- Her karar `moderation_log` ve audit trail'e yazılır; itiraz akışı insana dönüş
  sağlar.

## Kabul edilen riskler

Tek VPS modeli host patch/backup/capacity sorumluluğunu işletmeciye bırakır.
Cloudflare, SMTP ve etkin OAuth sağlayıcıları dış bağımlılıktır. Üretime yük
testi yapılmaz; harness yalnız izole lokal build'i kabul eder.
