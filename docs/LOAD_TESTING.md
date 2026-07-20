# High-concurrency load testing

🇹🇷 [Türkçe sürüm](LOAD_TESTING.tr.md)

The load gate runs against an isolated local production build. It never sends
synthetic traffic to `burncpu.com`.

It holds authenticated notification SSE streams open while a keep-alive HTTP
burst exercises health, timeline, search and sitemap paths. The run fails on any
SSE connection failure, network error, non-2xx response, HTTP p95 above 1.5 s or
HTTP p99 above 5 s.

## Profiles

| Profile | SSE connections | HTTP concurrency | HTTP requests | Automation |
|---|---:|---:|---:|---|
| Pull request | 1,000 | 200 | 2,000 | 5 s stream hold; every backend/load change |
| Scheduled soak | 10,000 | 500 | 10,000 | 60 s stream hold; weekly |

Run the default profile after starting the pinned development services and the
application on port 3050:

```sh
docker compose -f docker-compose.dev.yml up -d --wait
docker compose -f docker-compose.dev.yml exec -T postgres \
  psql -U burncpu -d burncpu < load/seed.sql
node load/high-concurrency.mjs
```

The runner requires Node 20 or newer. Controls are environment variables:
`BASE_URL`, `ALLOW_NONLOCAL_BASE_URL`, `SSE_COOKIE`, `SSE_CONNECTIONS`, `HTTP_CONCURRENCY`,
`HTTP_REQUESTS`, `SSE_HOLD_MS`, `REQUEST_TIMEOUT_MS`,
`SSE_CONNECT_TIMEOUT_MS`, `MAX_HTTP_P95_MS` and `MAX_HTTP_P99_MS`.
Numeric controls are validated before any traffic is generated. To protect a
developer laptop or a shared CI worker from accidental exhaustion, one run is
bounded at 10,000 SSE connections, 5,000 HTTP workers and 1,000,000 HTTP
requests. The 10,000-SSE scheduled profile is the intentional upper bound; a
larger experiment must use a dedicated load runner and an explicitly isolated
environment. `BASE_URL` is restricted to loopback and the live
`burncpu.com` domain is always refused; an isolated staging origin requires
the explicit `ALLOW_NONLOCAL_BASE_URL=true` opt-in.
