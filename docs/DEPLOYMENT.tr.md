# burncpu — Dağıtım ve operasyon

[English](DEPLOYMENT.md). Platform VPS3 üzerinde Cloudflare arkasında tek app
container, Postgres, Redis ve Meilisearch olarak çalışır.

## Akış

`main`'e PR merge edilince self-hosted runner `deploy-burncpu.sh` çalıştırır:
backend `/opt/burncpu/app`'e rsync edilir, SPA nginx root'a build edilir, app
image'ı (migration'larla) yenilenir ve `https://burncpu.com/healthz` ile gate edilir.
Cached deploy birkaç dakika, cold Rust rebuild 60 dakikaya kadar sürebilir.

## Portlar ve sağlık

Container Axum `:3050` dinler; hostta yalnız `127.0.0.1:3060` yayınlanır. nginx
TLS/security headers ile `:3060`'a proxy eder. Postgres/Redis/Meilisearch public
port açmaz. Başarılı deploy sonrası:

```bash
curl -fsS https://burncpu.com/healthz
ssh vps3 'docker ps --format "{{.Names}} {{.Status}}" | grep burncpu'
```

## Yedek ve geri dönüş

Gece Postgres dump'ı yedi günlük rotasyonla tutulur. Host snippet'i değiştirirken
backup alın, `nginx -t` çalıştırın ve kontrollü reload yapın. Off-site backup,
secret rotation, disk/CPU izleme ve kapasite planı işletmecinin sorumluluğudur.
Üretim yükü harness tarafından reddedilir; yük testi izole lokal build'de yapılır.
