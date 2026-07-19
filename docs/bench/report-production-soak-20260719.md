# Production performance report — organic + post-fix soak

**Date:** 2026-07-19 (UTC)  
**Public endpoint:** https://router.budgezen.com  
**Live binary:** `0.5.35-mw.4` (4 workers, Redis `:6381`, undici, better-sqlite3 + WAL)  
**Host:** `faiz-prod-01` / `82.25.62.204`  
**Related gate:** [`report-mw-20260719.md`](./report-mw-20260719.md) (§5 k6 load — GREEN)

---

## 1. Executive summary

| Dimension | Result |
| --------- | ------ |
| Status | **PRODUCTION STABLE** |
| Synthetic load gate (§5) | **2.53×** baseline · **905.5 rps** · **0%** error · no double-request |
| Organic production traffic | **~166 RPM avg** · peak **~278 RPM** · **0× 5xx** |
| Dashboard live aggregate | **GLOBAL** via Redis `mw:live:*` (no per-worker flicker) |
| Workers | Always **4** · health `workerId` rotates 1–4 |
| Isolation | Redis **6381 only** · foreign 6379/6380 untouched |

This document is the **public-facing production soak evidence** after go-live HTTPS and after the multi-worker live-usage fix (global pending / recent ring).

---

## 2. Environment under test

| Component | Value |
| --------- | ----- |
| Edge | Cloudflare Proxied + Nginx Origin CA · Full (strict) |
| App bind | `127.0.0.1:20128` · systemd `9router-mw` |
| Cluster | `cluster.fork` · **WORKERS=4** always |
| Redis | Docker `9router-mw-redis` · `127.0.0.1:6381` |
| SQLite | better-sqlite3 · journal_mode=WAL |
| HTTP client | undici keep-alive Agent (connections=32) |
| MITM | OFF |
| Health contract | `GET /api/health` → `ok`, `workers:4`, redis ready, undici, sqlite driver |

---

## 3. Synthetic load gate (k6) — reference

Full methodology and scripts: [`report-mw-20260719.md`](./report-mw-20260719.md).

| Metric | Target | Measured | Gate |
| ------ | ------ | -------- | ---- |
| Concurrent | 200 VU | peak 200 hold 2m | **PASS** |
| Throughput vs single | ≥1.5× (~358 rps) | **905.5 rps (2.53×)** | **PASS** |
| p95 TTFB (health) | < 2s | **241 ms** | **PASS** |
| Error rate | < 1% | **0%** | **PASS** |
| No double upstream | 1:1 | mock_reqs = k6_http_reqs | **PASS** |
| Worker kill respawn | < 5s | **~1 s** | **PASS** |
| Full restart | < 30s | **~2.8 s** | **PASS** |
| Soak (k6 health) | 30m (waiver 10m@100) | ~946 rps · 0% fail | **PASS** (waiver) |

**Single-process baseline:** ~**358 rps** (`docs/bench/baseline-single-20260718-summary.md`).

---

## 4. Production organic soak (post live-usage fix)

### 4.1 Pre-fix organic baseline (reference)

| Field | Value |
| ----- | ----- |
| Window | ~10 minutes |
| Artifact | `/tmp/9router-mw-soak-10m-20260719T072250Z.tsv` (VPS) |
| cum `/v1` | ~1,009 |
| RPM avg | ~**100** |
| Peak sample | ~**234** RPM |
| 5xx | **0** |
| Workers | 4 · redis ok |

### 4.2 Post-fix synthetic + organic soak

| Field | Value |
| ----- | ----- |
| Window | 2026-07-19T08:05:32Z → 08:15:11Z (~10 min) |
| Artifact | `/tmp/9router-mw-soak-10m-rerun-20260719T080532Z.tsv` |
| cum `/v1` | **1,823** |
| RPM v1 avg | ~**192** |
| Peak 30s | 130 req → ~**260 RPM** |
| 5xx | **0** |
| workers / redis | 4 / ok |
| `mw:live:recent` | **50** (cap) |

### 4.3 Production organic monitor (primary showcase)

| Field | Value |
| ----- | ----- |
| Mode | **Organic only** (real client traffic — Claude Code / API clients) |
| Window | 2026-07-19T08:24:17Z → 08:31:55Z (~7.5 min, 16 samples @ 30s) |
| Artifact | `/tmp/9router-mw-monitor-10m-20260719T082417Z.tsv` |
| cum total | **1,307** |
| cum `/v1` | **1,243** |
| **RPM v1 average** | **~166** |
| **Peak 30s** | **139** req → **~278 RPM** |
| Min 30s (quiet tail) | 2 req → ~4 RPM |
| Avg per 30s window | ~83 `/v1` |
| 5xx | **0** |
| 4xx | 20 |
| health | always 200 |
| workers | always **4** |
| redis | always ok (~1 ms ping) |
| `mw:live:recent` | **50** throughout |
| active max (global) | 1 |

#### RPM timeline (estimated = delta_v1 × 2 per 30s)

```text
s02  ~64   s03  ~58   s04 ~104   s05 ~136
s06 ~186   s07 ~144   s08 ~174   s09 ~188
s10 ~228  s11 ~204  s12 ~230  s13 ~210
s14 ~278  s15 ~278  s16   ~4   ← quiet tail
```

#### Load balance proof

Health probes during the same window returned rotating `workerId` **1 / 2 / 3 / 4**.  
Cluster = **capacity**, not request multiplication (see §5 no-double mock proof).

---

## 5. Multi-worker dashboard integrity (live usage)

| Symptom (pre-fix) | Cause | Fix |
| ------------------- | ----- | --- |
| RECENT REQUESTS / current request “flicker” / “rebutan worker” | Per-process `global._pendingRequests` + ring; SSE only saw local worker | Redis-backed global live state |

| Key / surface | Role |
| ------------- | ---- |
| `mw:live:cnt:{conn}\|{model}` | Pending counters (shared) |
| `mw:live:active` | Active set |
| `mw:live:recent` | Recent ring (LIST, cap 50) |
| `mw:live:lastErr` | Last error provider |
| Module | `open-sse/services/liveUsageState.js` |
| Hot path | `src/lib/db/repos/usageRepo.js` |
| SSE | `src/app/api/usage/stream/route.js` livePoll **1.5s** |
| Fail-open | Local Map if Redis unavailable (same pattern as account semaphore) |

**Verification:** under multi-worker load, Redis `LLEN mw:live:recent` = 50; dashboard recent list stable across worker rotation.

---

## 6. Comparative scoreboard

| Run | Mode | Window | RPM avg | Peak RPM | 5xx | Workers | Notes |
| --- | ---- | ------ | ------- | -------- | --- | ------- | ----- |
| F2 baseline | k6 health single | 60s | — | — | 0 | 1 | **~358 rps** absolute |
| F7 multi-worker | k6 health 200 VU | ramp+hold | — | — | 0 | 4 | **905.5 rps · 2.53×** |
| F7 soak | k6 health 100 VU | 10m waiver | — | — | 0 | 4 | ~946 rps |
| Pre-fix organic | nginx access | ~10m | ~100 | ~234 | 0 | 4 | before liveUsageState |
| Post-fix soak | synth+organic | ~10m | ~192 | ~260 | 0 | 4 | after Redis live state |
| **Monitor organic** | **organic only** | **~7.5m** | **~166** | **~278** | **0** | **4** | **primary production showcase** |

> **RPM vs RPS:** organic tables report **requests per minute** from nginx access deltas (production chat/API path). k6 tables report **requests per second** on the health path under synthetic load. Do not mix units when quoting.

---

## 7. Pass / fail checklist

| Check | Result |
| ----- | ------ |
| Public HTTPS health 200 | **PASS** |
| Always 4 workers | **PASS** |
| Redis 6381 only | **PASS** |
| 0× 5xx under organic peak ~278 RPM | **PASS** |
| No double-request (mock 1:1) | **PASS** |
| Global recent ring (no flicker) | **PASS** |
| Isolation foreign Redis | **PASS** |
| Secrets not in artifacts | **PASS** |

---

## 8. How to reproduce (ops)

### Synthetic (k6)

```bash
# from repo (see scripts under docs/bench/)
k6 run docs/bench/k6-load-health-200.js
k6 run docs/bench/k6-load-mock-upstream.js
k6 run docs/bench/k6-soak-health.js
```

### Organic monitor pattern (VPS)

Sample every 30s for N minutes: nginx access delta for `/v1`, health JSON, Redis `LLEN mw:live:recent`, worker count. Artifacts retained on host under `/tmp/9router-mw-*-*.tsv`.

---

## 9. Conclusion

**9router-MW production** meets the multi-worker performance charter:

1. Synthetic gate **2.53×** single-process throughput with **0%** errors and proven **no double upstream**.  
2. Real organic production traffic sustained **~166 RPM average** with peaks **~278 RPM** and **zero 5xx**.  
3. Live dashboard aggregates are **cluster-correct** via Redis `mw:live:*`.  
4. Invariants hold: **4 workers**, Redis **6381 only**, better-sqlite3+WAL, MITM off, localhost bind.

**Sign-off:** PRODUCTION PERFORMANCE — GREEN (2026-07-19).

See also: [`docs/RELEASE.md`](../RELEASE.md) · [`docs/ARCHITECTURE-MW.md`](../ARCHITECTURE-MW.md) · [public health](https://router.budgezen.com/api/health).
