# Yük testi

[English](LOAD_TESTING.md). Gate, `burncpu.com`'a asla sentetik trafik göndermez;
izole lokal production build'inde authenticated SSE bağlantılarını açık tutarken
health/timeline/search/sitemap HTTP burst çalıştırır.

| Profil | SSE | HTTP eşzamanlılık | İstek | Süre |
|---|---:|---:|---:|---:|
| PR | 1.000 | 200 | 2.000 | 5 sn |
| Scheduled soak | 10.000 | 500 | 10.000 | 60 sn |

Gate; SSE/network hatası, non-2xx, HTTP p95 >1.5s veya p99 >5s olursa fail olur.
Node 20+ gerekir. Servisleri başlatıp `load/seed.sql` yükledikten sonra
`node load/high-concurrency.mjs` çalıştırın. `LOAD_BASE_URL` production hostuna
ayarlanırsa script fail-closed davranır.
