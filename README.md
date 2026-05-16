# burncpu.com

> ⚠️ **alpha** — şu an aktif geliştirme aşamasındadır. Breaking changes haftalık olur. Production'da kullanmayın, fork edip kendinizinkini kurmak isterseniz Hafta 4'ten sonra deneyin.

Kendi sosyal medyamız. Hızlı, güvenli, kontrolümüzde.

🌐 Canlı: **https://burncpu.com**
🐢 Yazar: [Mustafa Erbay](https://mustafaerbay.com.tr)
📜 Lisans: MIT (kod) — brand & ME mascot hariç

## Neden var

> "Başkasının kurallarına bağımlı kalmak istemiyorum."

Bu repo o günün sabah projesi. 12 saatte sıfırdan:
- Domain (Cloudflare)
- VPS3 infrastructure (Postgres + Redis + Meilisearch)
- Rust + Axum backend (multi-stage Docker, ~30MB image)
- Magic-link auth (no passwords, no third party)
- DB schema (users, sessions, posts, follows, reactions, moderation)
- HTTPS + Let's Encrypt + Cloudflare proxy

## Stack

- **Rust + Axum + tokio** — yüksek performans, az kaynak
- **PostgreSQL 16** — birincil veri (UUID PK, JSONB, indexed)
- **Redis 7** — rate limit, cache, session lookup
- **Meilisearch v1.10** — typo-tolerant search (hashtag + content)
- **SolidJS** (yakında) — modern reactive frontend
- **AI moderation** (yakında) — Gemini → Groq → Cerebras fallback

## Mimari prensipler

1. **1 VPS yeter** — k8s yok, microservice yok, doğru ölçü
2. **Tek dil per katman** — backend: Rust, frontend: TypeScript
3. **Federation-ready** — şimdilik stand-alone ama ActivityPub için açık
4. **AI-destekli moderation** — spam'a karşı 3-katmanlı savunma
5. **Self-hosted** — tüm dependency'ler VPS3'te, no external SaaS

## Çalıştırma

### Lokal geliştirme

```bash
git clone https://github.com/merbay-erp/burncpu.git
cd burncpu
cp .env.example .env
# .env'i düzenleyip Postgres URL, Redis URL set et

cargo build --release
cargo run --release
# http://127.0.0.1:3050/healthz
```

### Production (Docker)

```bash
ssh vps3 'cd /opt/burncpu && docker compose up -d'
# https://burncpu.com/healthz
```

## API

| Method | Path | Açıklama |
|--------|------|---------|
| `GET`  | `/` | Landing |
| `GET`  | `/healthz` | Liveness (Postgres + Redis ping) |
| `GET`  | `/api/v1` | API index |
| `POST` | `/api/v1/auth/request` | Magic-link iste (rate limited) |
| `GET`  | `/api/v1/auth/verify/{token}` | Token doğrula → session başlat |
| `POST` | `/api/v1/auth/logout` | Session iptal et |

Daha fazlası: bkz. [yol haritası](#yol-haritası).

## Yol haritası

**Hafta 1** — `[şu an buradayız]`
- [x] Repo + DNS + DB + Docker
- [x] Magic-link auth
- [ ] Session middleware (auth extractor)
- [ ] Post CRUD (markdown + XSS)
- [ ] Public timeline + RSS

**Hafta 2**
- [ ] Invite-only signup
- [ ] Profile sayfaları
- [ ] Follow/unfollow + personal timeline

**Hafta 3**
- [ ] Reactions + reply
- [ ] AI moderation engine (Gemini→Groq→Cerebras)

**Hafta 4**
- [ ] Meilisearch + hashtag + trending
- [ ] Admin moderation paneli

**Hafta 5+**
- [ ] Notification system
- [ ] PWA
- [ ] Federation (ActivityPub)

## Katkı

Şu an alpha — PR almıyoruz ama issue açabilirsiniz. Hafta 4'ten sonra
katkı kılavuzu yayınlanır.

**Güvenlik bildirimi:** lütfen issue açmayın → [SECURITY.md](SECURITY.md)

## Lisans

[MIT](LICENSE) — fork edin, ticari kullanın, türetip kendi platformunuzu
kurun. Tek kısıt: brand assets (logo, ME mascot, "burncpu" adı, içerikler)
ayrı haklara tabi.
