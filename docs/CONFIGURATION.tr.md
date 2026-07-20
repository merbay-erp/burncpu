# burncpu — Yapılandırma

[English](CONFIGURATION.md). Tüm çalışma zamanı ayarları environment variable'dır;
lokalde `.env`, üretimde `/opt/burncpu/.env` kullanılır. Başlamak için
[`.env.example`](../.env.example) kopyalayın. Zorunlu tek ayar `DATABASE_URL`;
admin 2FA için ayrıca `BURNCPU_ENC_KEY` gerekir.

## Temel ayarlar

| Değişken | Varsayılan / not |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantısı; zorunlu |
| `BIND_ADDR` | `127.0.0.1:3050` |
| `REDIS_URL` | `redis://127.0.0.1:6380` |
| `SITE_ORIGIN` | `https://burncpu.com` |
| `DB_MAX_CONNECTIONS` | `48`; container bütçesinin altında tutun |
| `BURNCPU_ENC_KEY` | admin TOTP secret şifrelemesi |
| `MEILI_URL` / `MEILI_MASTER_KEY` | arama servisi |

## Kimlik, mobil ve moderasyon

OAuth için provider client ID/secret/callback değişkenleri; mobil universal link
için `IOS_APP_ID` ve `ANDROID_CERT_FINGERPRINTS`; native push için Expo/FCM/APNs
ayarları gerekir. `TOXICITY_*`, report-threshold, account-heat ve shadow-ban
değişkenleri moderasyon eşiklerini belirler. SMTP değişkenleri magic-link ve
bildirim e-postalarını açar.

Booleans `1/true/yes/on` kabul eder. Gizli değerleri commit etmeyin; production
secret rotation ve yedekleme [deploy runbook'unda](DEPLOYMENT.tr.md) anlatılır.
