# burncpu — mobile LCP / SSR improvement plan

> Historical measurement: 2026-06-06. Status refreshed: 2026-07-20.
> This document does not change code. SSR remains a separate decision/PR.
> Font self-hosting, preload and `font-display: swap` are complete; the lab
> numbers below stay historical until a new Lighthouse run.
>
> [Türkçe](PERF-LCP-PLAN.tr.md)

## Measured baseline

Anonymous `/`, Lighthouse mobile (slow 4G, 4× CPU throttle): LCP ~9.7s, FCP
1.3–2.0s, TBT 0–14ms, CLS <0.1 and performance 72–75.

The LCP phases were approximately 57% load delay (5.7s), 35% load time
(3.46s) and 8% TTFB/render. Load delay is the client-rendered SPA waiting for
JS boot, `/posts` and Solid rendering. Load time is the cover image arriving
from the separate blog origin. In a normal connection the same cover measured
0.18s, so this is primarily a lab and slowest-user problem.

## Options

### A — Full SolidStart migration

Move the web app to a Node SSR service beside the Rust API. This offers the
cleanest hydration/SEO story but requires a routing, data-fetching, deployment
and CSP migration with a large risk surface.

### B — Lightweight first-paint SSR (recommended)

For anonymous `/`, have Axum inject the first three cached posts and the first
cover image into `index.html`; the SPA then takes over. A feature flag, CSP
hashes and mismatch tests keep the rollout reversible. This targets the
measured delay without replacing SolidJS. Expected lab LCP: about 3.5–4s.

### C — Static shell / placeholder

Add a meaningful above-the-fold skeleton. It improves perceived speed but does
not move the real LCP image before JavaScript, so the gain is smaller and the
risk is low.

## Decision frame

Choose B when PSI lab scores or the slowest users matter. If the goal is median
real-user experience, the existing client is already fast enough and SSR can be
deferred. A full SolidStart migration is intentionally not planned for a
cosmetic lab improvement. Blog cover optimisation, CDN transforms and a WebP
migration remain a separate cost/benefit decision.
