# burncpu.com

> **Built for humans who still think before posting.**
> Low ego. High signal. Internet for people who build things.

> ⚠️ **alpha** — aktif geliştirme. Breaking changes haftalık olabilir.
> Production'da kullanmayın; fork edip kendinizinkini kurmak isterseniz
> Hafta 4'ten sonra deneyin.

🌐 Canlı: **https://burncpu.com**
🐢 Yazar: [Mustafa Erbay](https://mustafaerbay.com.tr)
📜 Lisans: MIT (kod) — brand & ME mascot hariç

## Manifesto

**1 VPS yeter.**

k8s yok. Microservice yok. "Serverless" yok. Tek bir sunucu, doğru ölçü,
ölçülebilir kaynak. Bu sadece infra tercihi değil — engineering yaklaşımı,
anti-bloat tavır, anti-corporate his.

İnternet yakında AI içerikle dolacak. AI tweet, AI reply, AI engagement
farming. Bizim hedefimiz tam tersi: **gerçek insanların yazdığı, düşünerek
paylaşılan, küçük ama yüksek-sinyalli bir alan.** Az kişi, çok değer.

## Stack

- **Rust + Axum + tokio** — hype için değil, gerçek kaynak verimliliği için
- **PostgreSQL 16** — birincil veri (UUID PK, JSONB, audit trail)
- **Redis 7** — rate limit, session lookup
- **Meilisearch v1.10** — typo-tolerant arama
- **SolidJS** (yakında) — modern, küçük, reactive frontend
- **Spam-resistant discussion system** (yakında) — model-agnostik, çok katmanlı

## Mimari prensipler

1. **1 VPS yeter** — doğru ölçü, dikkatli mühendislik
2. **No third-party auth** — magic-link, şifre yok, OAuth çöplüğü yok
3. **Spam-resistant by design** — moderation marketing değil, mimari karar
4. **Tek dil per katman** — backend: Rust, frontend: TypeScript
5. **Self-hosted** — tüm dependency'ler VPS3'te, no external SaaS
6. **Federation sonra konuşulur** — önce tek instance kültürü, sonrası tartışılır

## Çalıştırma

### Lokal geliştirme

```bash
git clone https://github.com/merbay-erp/burncpu.git
cd burncpu
cp .env.example .env
# .env: DATABASE_URL, REDIS_URL, SITE_ORIGIN

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
| `GET`    | `/` | Landing |
| `GET`    | `/healthz` | Liveness (Postgres + Redis ping) |
| `GET`    | `/api/v1` | API index |
| `POST`   | `/api/v1/auth/request` | Magic-link iste (rate-limited per IP+email) |
| `GET`    | `/api/v1/auth/verify/{token}` | Token doğrula → session başlat |
| `POST`   | `/api/v1/auth/logout` | Session iptal et |
| `POST`   | `/api/v1/posts` | Post oluştur (auth, markdown sanitize) |
| `GET`    | `/api/v1/posts` | Public timeline (keyset pagination) |
| `GET`    | `/api/v1/posts/{id}` | Tek post |
| `DELETE` | `/api/v1/posts/{id}` | Soft delete (yazar veya admin) |
| `POST`   | `/api/v1/posts/{id}/react` | Emoji ile reaksiyon (🔥🐢🤝🙏😂) |
| `DELETE` | `/api/v1/posts/{id}/react` | Reaksiyonu kaldır |
| `GET`    | `/api/v1/posts/{id}/reactions` | Tally + viewer'ın reaksiyonu |
| `GET`    | `/api/v1/feed` | Personal home (own + followees, auth) |
| `GET`    | `/api/v1/users/{username}` | Profile + counts |
| `PATCH`  | `/api/v1/users/me` | display_name / bio / avatar_url |
| `POST`   | `/api/v1/users/{username}/follow` | Follow |
| `DELETE` | `/api/v1/users/{username}/follow` | Unfollow |
| `GET`    | `/api/v1/users/{username}/followers` | Liste |
| `GET`    | `/api/v1/users/{username}/following` | Liste |
| `POST`   | `/api/v1/invites` | Davet kodu oluştur (auth, 5/gün, 14d TTL) |
| `GET`    | `/api/v1/invites` | Kendi davetlerin |
| `GET`    | `/api/v1/invites/{code}` | Kod geçerli mi (public) |
| `DELETE` | `/api/v1/invites/{code}` | Kullanılmamış kodu iptal et |

## Yol haritası

**Hafta 1** `[şu an buradayız]`
- [x] Repo + DNS + DB + Docker
- [x] Magic-link auth + audit + session hijack flag
- [x] Post CRUD (markdown + XSS sanitize) + public timeline
- [x] Reactions (5-emoji set)
- [x] Profiller, follow graph, personal feed
- [x] Invite-only signup (env-flagged, dark-launched)
- [ ] Frontend (SolidJS scaffold)
- [ ] RSS feed

**Hafta 2**
- [ ] TOTP 2FA (admin gate)
- [ ] Reply threading
- [ ] Notification system

**Hafta 3**
- [ ] Spam-resistant filtering engine (model-agnostik, çok katmanlı)
- [ ] Admin moderation paneli

**Hafta 4**
- [ ] Meilisearch + hashtag + trending
- [ ] PWA

**Hafta 5+**
- [ ] Federation — sadece tek instance kültürü oturduktan sonra

## Katkı

Alpha — PR almıyoruz. Issue açabilirsiniz; Hafta 4'ten sonra katkı
kılavuzu yayınlanır.

**Güvenlik bildirimi:** issue açmayın → [SECURITY.md](SECURITY.md)

## Lisans

[MIT](LICENSE) — fork edin, ticari kullanın, türetin. Tek kısıt: brand
assets (logo, ME mascot, "burncpu" adı, içerikler) ayrı haklara tabi.
