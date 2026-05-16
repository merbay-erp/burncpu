# burncpu.com

Kendi sosyal medyamız. Hızlı, güvenli, kontrolümüzde.

## Stack

- **Rust + Axum + tokio** — yüksek performans backend
- **PostgreSQL 16** — birincil veri
- **Redis 7** — cache, rate limit, session
- **Meilisearch** — full-text + typo-tolerant arama
- **SolidJS** (gelecek) — modern reactive frontend
- **AI moderation** — Gemini → Groq → Cerebras fallback chain

## Mimari prensipler

- Self-hosted, 1 VPS (vps3, mustafaerbay.com.tr ile aynı)
- Az kaynak + yüksek throughput
- AI-destekli güçlü spam/moderation
- Invite-only signup (early days)
- Federation hazır mimari (ActivityPub gelecekte)

## Yerel geliştirme

```bash
# 1. Postgres + Redis + Meilisearch container'larını başlat
cd ../mustafaerbay && ssh vps3 "cd /opt/burncpu && docker compose up -d"
# veya lokal Docker:  (TODO)

# 2. .env
cp .env.example .env
# DATABASE_URL içine VPS3'teki burncpu-pg şifresini yaz

# 3. Build + run
cargo run --release

# 4. Smoke test
curl http://127.0.0.1:3050/healthz
```

## Endpoints

| Method | Path | Açıklama |
|--------|------|---------|
| `GET`  | `/` | Landing |
| `GET`  | `/healthz` | Liveness (Postgres + Redis ping) |
| `GET`  | `/api/v1/` | API index |

Daha fazlası: bkz. roadmap.

## Yol haritası

1. **Hafta 1** — Auth (magic link), post CRUD, public timeline, RSS
2. **Hafta 2** — Invite-only signup, profile, follow/unfollow
3. **Hafta 3** — Reactions, replies, AI moderation pipeline
4. **Hafta 4** — Search (Meilisearch), hashtag, trending
5. **Hafta 5+** — Admin panel, notifications, PWA, federation

## Lisans

MIT — kişisel kullanım, fork serbest. Bazı bileşenler (logo, ME mascot
sanat eseri, içerik) ayrı haklara tabidir.
