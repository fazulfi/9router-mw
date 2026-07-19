<div align="center">

<img src="./images/9router.png?1" alt="9router-MW" width="720"/>

# 9router-MW

**Production multi-worker AI routing gateway** — OpenAI-compatible `/v1/*`, high-concurrency cluster, Redis-shared resilience, undici keep-alive.

Fork of [decolua/9router](https://github.com/decolua/9router) optimized for **stable throughput at ~200 concurrent** on a bare-metal Linux VPS.

[![Release](https://img.shields.io/github/v/release/fazulfi/9router-mw?label=release&color=0B6E4F)](https://github.com/fazulfi/9router-mw/releases/latest)
[![Upstream](https://img.shields.io/badge/upstream-decolua%2F9router%200.5.35-555)](https://github.com/decolua/9router)
[![Status](https://img.shields.io/badge/status-PRODUCTION%20FINAL-0B6E4F)](./docs/RELEASE.md)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

**Public production:** [https://router.budgezen.com](https://router.budgezen.com) · **Health:** [`/api/health`](https://router.budgezen.com/api/health)

[Release status](./docs/RELEASE.md) · [Architecture](./docs/ARCHITECTURE-MW.md) · [Runbooks](./docs/runbooks/) · [**Benchmarks**](./docs/bench/) · [Synthetic load](./docs/bench/report-mw-20260719.md) · [Production soak](./docs/bench/report-production-soak-20260719.md) · [Upstream](https://github.com/decolua/9router)

</div>

---

## What this is

| | |
| --- | --- |
| **Product** | `9router-mw` — multi-worker production line of 9Router |
| **Repo** | https://github.com/fazulfi/9router-mw |
| **Repo version** | `0.5.35-mw.7` (`VERSION` / `package.json`) |
| **Live binary** | **`0.5.35-mw.7`** formal release (`/opt/9router-mw/releases/0.5.35-mw.7/.next/standalone`) |
| **Upstream base** | [decolua/9router](https://github.com/decolua/9router) `0.5.35` |
| **Resilience patterns** | Account semaphore + circuit breaker + settings cache (inspired by [Vanszs/VansRouter](https://github.com/Vanszs/VansRouter)) |

**Not** the npm package `9router` and **not** Docker Hub `decolua/9router`. This fork is private-ops / source deploy. For the general consumer product, install upstream.

---

## Why MW exists

Stock 9router is excellent as a single-process local gateway. Under high concurrent load on a multi-core VPS, a single Node process becomes the bottleneck (event-loop contention, sync SQLite/sql.js paths, no shared account claim across processes).

**9router-MW** keeps full upstream product capability (OpenAI-compatible API, multi-provider routing, RTK, combos, dashboard) and adds a production control plane:

1. **Always 4 workers** via `cluster.fork` in `custom-server.js` (no `WORKERS=1` production default)
2. **Redis `127.0.0.1:6381` only** — shared semaphore, circuit breaker, usage buffer
3. **SQLite better-sqlite3 + WAL** — source of truth; **sql.js banned** in prod multi-worker
4. **undici keep-alive Agent** — connection reuse on the provider hot path
5. **No double-request** — one client HTTP request → exactly one worker → one upstream call (combo/account fallback is product behavior, not cluster fan-out)

### Topology

```text
Internet clients
    → Cloudflare (DNS Proxied + TLS edge)
    → Nginx :443 (Origin CA, Full strict)
    → 127.0.0.1:20128  Node primary (cluster)
         ├─ worker 1
         ├─ worker 2
         ├─ worker 3
         └─ worker 4
              ├─ undici keep-alive → upstream providers
              ├─ Redis 127.0.0.1:6381 → semaphore / breaker / usage buffer
              └─ SQLite WAL  /var/lib/9router-mw  → credentials, settings, history
MITM: OFF in production
```

### Double-request guarantee

Cluster is **capacity**, not **multiplication**. The kernel / load balancer delivers each TCP/HTTP request to **one** worker. Proven under load: mock upstream request count == k6 client request count (`docs/bench/report-mw-20260719.md`).

---

## Production snapshot

| Check | Result |
| ----- | ------ |
| Public URL | https://router.budgezen.com |
| `GET /api/health` | **200** — `ok`, `workers:4`, redis ready, undici, better-sqlite3/WAL |
| `GET /` | **307** → `/dashboard` |
| `GET /v1/models` (no key) | **401** API key required |
| App bind | `127.0.0.1:20128` only (not public) |
| Redis | **6381 only** — foreign `:6379` / `:6380` untouched |
| Edge | Cloudflare Proxied + Nginx TLS (Origin CA) + Full (strict) |

### Production invariants (never violate)

1. Workers always **4**
2. Redis only port **6381**
3. SQLite only **better-sqlite3 + WAL** (no sql.js)
4. MITM **OFF** in production
5. Bind **localhost**; public only via Nginx
6. **No secrets in git**
7. **No double-request** semantics

---

## Performance & benchmarks

Enterprise evidence pack: synthetic k6 gates **plus** production organic soak on the live public edge.  
**Index:** [`docs/bench/`](./docs/bench/) · **SSOT release:** [`docs/RELEASE.md`](./docs/RELEASE.md)

### Scoreboard (headline)

| Suite | Mode | Result | Status |
| ----- | ---- | ------ | ------ |
| **§5 multi-worker load** | k6 health · 200 VU | **905.5 rps** = **2.53×** single baseline (~358 rps) | **GREEN** |
| p95 TTFB (health) | k6 | **241 ms** (target &lt; 2s) | **PASS** |
| Error rate | k6 | **0%** | **PASS** |
| No double upstream | mock counter 1:1 | client reqs = upstream reqs | **PASS** |
| Worker respawn | `kill -9` one worker | **~1 s** back to 4 workers | **PASS** |
| Full restart | systemd | **~2.8 s** ready | **PASS** |
| **Production organic** | real `/v1` traffic | **~166 RPM avg** · peak **~278 RPM** · **0× 5xx** | **GREEN** |
| Live dashboard aggregate | Redis `mw:live:*` | global recent/pending across 4 workers (no flicker) | **PASS** |

> **Units:** synthetic tables use **RPS** (requests/second, health path). Organic tables use **RPM** (requests/minute from nginx `/v1` deltas). Do not mix when quoting.

### Synthetic load gate (§5) — GREEN

| Metric | Target | Measured |
| ------ | ------ | -------- |
| Concurrent | 200 VU | peak 200 · hold 2m |
| Throughput | ≥1.5× single (~358 rps) | **905.5 rps (2.53×)** |
| p95 TTFB (health) | &lt; 2s | **241 ms** |
| Error rate | &lt; 1% | **0%** |
| No double upstream | 1:1 mock | **PASS** |
| Worker kill respawn | &lt; 5s | **~1 s** |
| Full restart | &lt; 30s | **~2.8 s** |
| k6 soak | 30m (waiver 10m @ 100 VU) | ~946 rps · 0% fail |

Full methodology: [`docs/bench/report-mw-20260719.md`](./docs/bench/report-mw-20260719.md)

### Production organic soak — GREEN

Measured on **live** https://router.budgezen.com after go-live (4 workers · Redis 6381 · undici · better-sqlite3+WAL).

| Run | Mode | Window | RPM avg | Peak RPM | 5xx | Workers |
| --- | ---- | ------ | ------- | -------- | --- | ------- |
| Pre-fix organic | real clients | ~10m | ~100 | ~234 | 0 | 4 |
| Post-fix soak | synth + organic | ~10m | ~192 | ~260 | 0 | 4 |
| **Monitor (showcase)** | **organic only** | **~7.5m** | **~166** | **~278** | **0** | **4** |

**Showcase window (2026-07-19 UTC):** cum `/v1` **1,243** · cum total **1,307** · redis ok · health always 200 · `workerId` rotates **1–4** (round-robin, not double-request).

```text
Organic RPM timeline (est. per 30s window ×2)
~64 → ~58 → ~104 → ~136 → ~186 → ~144 → ~174 → ~188
→ ~228 → ~204 → ~230 → ~210 → ~278 → ~278 → ~4 (quiet tail)
```

Full production report: [`docs/bench/report-production-soak-20260719.md`](./docs/bench/report-production-soak-20260719.md)

### What “no double-request” means

| Claim | Meaning | Proof |
| ----- | ------- | ----- |
| Cluster capacity | 1 client HTTP request → **exactly one** worker | health `workerId` rotation under load |
| Upstream isolation | 1 client request → **1** mock upstream call | k6 mock counter equality |
| Not fan-out | Workers do **not** each re-dispatch the same client request | mock 1:1 + organic path analysis |

Combo / account **fallback** (try next account on failure) is product routing behavior — not cluster multiplication.

### Multi-worker live UI integrity

| Before | After |
| ------ | ----- |
| Dashboard “RECENT REQUESTS” flickered (per-worker in-memory ring) | Redis-backed global ring `mw:live:recent` (cap 50) + pending counters |
| SSE on worker A missed traffic on B/C/D | stream route livePoll **1.5s** reads shared Redis snapshot |

Module: `open-sse/services/liveUsageState.js` · fail-open if Redis down.

### Reproduce

```bash
# Synthetic (from repo)
k6 run docs/bench/k6-load-health-200.js
k6 run docs/bench/k6-load-mock-upstream.js
k6 run docs/bench/k6-soak-health.js

# Live health
curl -sS https://router.budgezen.com/api/health | jq .
```

---

## Quick start (local development)

Requires Node.js 22+, and for multi-worker parity: Redis on a dedicated port + native `better-sqlite3`.

```bash
git clone https://github.com/fazulfi/9router-mw.git
cd 9router-mw
npm install
# optional: build native SQLite (required for prod-like path)
npm rebuild better-sqlite3

# minimal env (do not commit real secrets)
export PORT=20128
export WORKERS=4
export REDIS_URL=redis://127.0.0.1:6381
export DATA_DIR=./data
export REQUIRE_API_KEY=true
export ENABLE_REQUEST_LOGS=false

npm run build
node custom-server.js
```

- Dashboard: `http://127.0.0.1:20128/dashboard`
- Health: `http://127.0.0.1:20128/api/health`
- OpenAI-compatible API: `http://127.0.0.1:20128/v1/*` (API key required when `REQUIRE_API_KEY=true`)

**Production deploy** is systemd + Nginx + dedicated Redis Docker on the VPS — not `npm start` on a public interface. See:

- [`docs/runbooks/deploy.md`](./docs/runbooks/deploy.md)
- [`docs/deploy/`](./docs/deploy/)
- [`docs/RELEASE.md`](./docs/RELEASE.md)

### Critical environment variables

| Variable | Production intent |
| -------- | ----------------- |
| `WORKERS` | Always `4` |
| `REDIS_URL` / Redis host | `127.0.0.1:6381` only |
| `DATA_DIR` | e.g. `/var/lib/9router-mw` |
| `REQUIRE_API_KEY` | `true` for remote `/v1/*` |
| `ENABLE_REQUEST_LOGS` | `false` under load |
| `PORT` | `20128` (bound localhost behind Nginx) |

Secrets (`JWT_SECRET`, `API_KEY_SECRET`, `INITIAL_PASSWORD`, provider tokens) live only in the host env file (e.g. `/etc/9router-mw/env`) — never in this repository.

---

## Documentation map

| Document | Role |
| -------- | ---- |
| [`docs/RELEASE.md`](./docs/RELEASE.md) | **SSOT** — production final status, version map, sign-off |
| [`docs/ARCHITECTURE-MW.md`](./docs/ARCHITECTURE-MW.md) | MW topology, health contract, invariants |
| [`docs/plans/9router-mw-production-plan.md`](./docs/plans/9router-mw-production-plan.md) | Locked architecture plan (executed) |
| [`docs/runbooks/`](./docs/runbooks/) | Deploy, rollback, backup, go-live, upstream-sync |
| [`docs/deploy/`](./docs/deploy/) | systemd, nginx, env examples, ops scripts |
| [`docs/bench/`](./docs/bench/) | Bench index — synthetic + production |
| [`docs/bench/report-mw-20260719.md`](./docs/bench/report-mw-20260719.md) | §5 synthetic load gate (2.53×) |
| [`docs/bench/report-production-soak-20260719.md`](./docs/bench/report-production-soak-20260719.md) | Production organic soak (~166 RPM) |
| [`docs/evidence/`](./docs/evidence/) | Phase 00–09 proofs |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Upstream 9router architecture (stock) |
| [`CHANGELOG.md`](./CHANGELOG.md) | Version history (mw section) |

---

## Product capabilities (upstream)

Everything you expect from 9Router remains available on this fork:

- OpenAI-compatible **`/v1/chat/completions`**, **`/v1/models`**, streaming SSE
- Multi-provider routing with format translation (OpenAI pivot)
- Account rotation, combos, quota-aware fallback
- **RTK** token saver and related pre-dispatch hooks
- Web dashboard for providers, proxies, combos, usage

Deep product guides, provider setup videos, and consumer install paths live upstream:

- Upstream repo: https://github.com/decolua/9router  
- Upstream site: https://9router.com  

This README intentionally does **not** duplicate the full marketing catalog or i18n grid — those belong to upstream.

---

## Versioning

| Artifact | Version |
| -------- | ------- |
| Upstream base | `decolua/9router` **0.5.35** |
| Git tag (latest) | **`v0.5.35-mw.7`** (Redis global live usage) |
| Repo `VERSION` / `package.json` | **0.5.35-mw.7** |
| Live runtime release dir | **`0.5.35-mw.7`** (formal deploy 2026-07-19; rollback: `0.5.35-mw.4`) |

Scheme: `0.5.35-mw.N` = upstream base + multi-worker production line.  
**mw.7** is live in production: Redis global live usage (`mw:live:*`) + all multi-worker hot path. Rollback path: `0.5.35-mw.4` kept on disk.

---

## Ops & data (production)

| Area | State |
| ---- | ----- |
| Engineering F0–F9 | **ACCEPTED** |
| Load §5 (synthetic) | **GREEN** — 2.53× · 905.5 rps · 0% err |
| Production organic soak | **GREEN** — ~166 RPM avg · peak ~278 · 0× 5xx |
| Live usage (dashboard) | **GLOBAL** Redis `mw:live:*` (no worker flicker) |
| Public HTTPS | **LIVE** |
| Provider data | Migrated non-mimo connections + custom nodes + proxy pools + combos + model kv |
| `apiKeys` | Not auto-migrated — create on dashboard if needed |
| MITM | **OFF** |

Operational residual checklist (optional): real provider smoke at low QPS, 24–48h watch, monthly upstream sync via [`docs/runbooks/upstream-sync.md`](./docs/runbooks/upstream-sync.md).

---

## Attribution & license

- **Base product:** [decolua/9router](https://github.com/decolua/9router) — original authors and community  
- **Resilience ideas:** patterns adapted from [Vanszs/VansRouter](https://github.com/Vanszs/VansRouter) (semaphore / breaker / settings cache)  
- **MW control plane:** multi-worker cluster, Redis shared state, undici pool, production ops — this repository  
- **License:** MIT — see [`LICENSE`](./LICENSE)

Keep an `upstream` remote and follow [`docs/runbooks/upstream-sync.md`](./docs/runbooks/upstream-sync.md) for monthly rebases.

---

## Contributing

| Kind of change | Where |
| -------------- | ----- |
| Multi-worker, Redis, undici, deploy, MW docs | Issues / PRs on **this** repo |
| New providers, translators, dashboard features for everyone | Prefer **upstream** [decolua/9router](https://github.com/decolua/9router) then sync |

Please do not open PRs that reintroduce:

- sql.js as the production SQLite path under multi-worker  
- Redis on 6379/6380 for this product  
- Secrets, production env files, or private keys in git  
- `WORKERS=1` as a production default  

---

## Support pointers

| Need | Link |
| ---- | ---- |
| Is production healthy? | https://router.budgezen.com/api/health |
| Final release status | [`docs/RELEASE.md`](./docs/RELEASE.md) |
| Deploy / rollback | [`docs/runbooks/`](./docs/runbooks/) |
| Benchmarks (all) | [`docs/bench/`](./docs/bench/) |
| Synthetic load (2.53×) | [`docs/bench/report-mw-20260719.md`](./docs/bench/report-mw-20260719.md) |
| Production soak (~166 RPM) | [`docs/bench/report-production-soak-20260719.md`](./docs/bench/report-production-soak-20260719.md) |
| Upstream product help | https://github.com/decolua/9router |

---

<div align="center">

**9router-MW** · PRODUCTION FINAL · `v0.5.35-mw.7`  
**2.53×** synthetic · **~166 RPM** organic · **0%** 5xx under peak  
Built on [decolua/9router](https://github.com/decolua/9router) · High-concurrency production routing

</div>
