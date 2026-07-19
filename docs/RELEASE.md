# 9router-MW — Final Release Status

> **Status:** **PRODUCTION FINAL** (2026-07-19)  
> **Product:** `9router-mw`  
> **Repo:** https://github.com/fazulfi/9router-mw  
> **Public URL:** https://router.budgezen.com  
> **Git tag (docs/ops):** `v0.5.35-mw.6`  
> **Live app binary:** `0.5.35-mw.4` (`/opt/9router-mw/releases/0.5.35-mw.4/.next/standalone`)  
> **Ops/scripts/docs line:** `0.5.35-mw.6` (includes go-live SSL + data migration evidence)

---

## 1. What shipped

| Layer | Delivered |
| ----- | --------- |
| Multi-worker | Always **4** workers via `cluster.fork` in `custom-server.js` |
| Shared state | Redis **only** `127.0.0.1:6381` (semaphore, circuit breaker, usage buffer) |
| Persistence | SQLite **better-sqlite3 + WAL** at `/var/lib/9router-mw` (sql.js banned in prod MW) |
| Hot path | undici keep-alive Agent (connections=32, pipelining=1) |
| Resilience | Account semaphore + circuit breaker + 5s settings memory cache (Vans-style) |
| Edge | Cloudflare Proxied + Nginx TLS (Origin CA) + Full (strict) |
| Ops | systemd, logrotate, daily backup cron, rollback script, runbooks |
| Load gate §5 | **GREEN** — 2.53× baseline, p95 241ms, 0% err, no double-request |

**Not double-request:** one client HTTP request → one worker → one upstream call (proven with mock upstream 1:1).

---

## 2. Production endpoints

| Check | Result |
| ----- | ------ |
| `https://router.budgezen.com/api/health` | **200** — `ok:true`, `workers:4`, redis ready, undici, better-sqlite3/wal |
| `https://router.budgezen.com/` | **307** → `/dashboard` |
| `https://router.budgezen.com/v1/models` (no key) | **401** API key required |
| Local bind | `127.0.0.1:20128` only (not public) |
| Foreign Redis | `:6379` / `:6380` **untouched** |

---

## 3. Data migration (source → MW)

**Source:** `root@49.12.82.34:39999` — active `9router.service`, `DATA_DIR=/var/lib/9router`  
**Dest:** `root@82.25.62.204` — `9router-mw`, `/var/lib/9router-mw/db/data.sqlite`

| Table / scope | Migrated | Count (dest final) | Notes |
| ------------- | -------- | ------------------ | ----- |
| `providerConnections` | yes (non-mimo) | **13727** | Exclude `xiaomi-mimo` + `xiaomi-tokenplan` name=`mimo` |
| `providerNodes` | yes | **3** | apikeyfun, inv=ferhub, tokenrouter |
| `proxyPools` | yes | **65** | all `isActive=1` |
| `combos` | yes | **8** | |
| `kv` customModels | yes | **48** | |
| `kv` modelAliases | yes | **56** | |
| `apiKeys` | **no** | 0 | regenerate on dest if needed |
| settings / usage* | **no** | — | intentionally out of scope |

Evidence: `docs/evidence/phase-09/01-provider-data-migration.md`

Backups on dest (examples):

- `/var/lib/9router-mw/db/backups/pre-provider-migrate-*`
- `/var/lib/9router-mw/db/backups/pre-nodes-proxies-*`

---

## 4. Phase completion matrix

| Phase | Name | Status | Evidence |
| ----- | ---- | ------ | -------- |
| 0 | Bootstrap repo/remotes/version | **DONE** | `docs/evidence/phase-00/` |
| 1 | VPS prep (user router, dirs, Redis 6381) | **DONE** | `docs/evidence/phase-01/` |
| 2 | Baseline single + nginx + k6 | **DONE** | `docs/evidence/phase-02/` |
| 3 | Multi-worker ×4 | **DONE** | `docs/evidence/phase-03/` |
| 4 | Redis shared state | **DONE** | `docs/evidence/phase-04/` |
| 5 | Vans resilience wire | **DONE** | `docs/evidence/phase-05/` |
| 6 | Hot-path (undici, WAL, logs) | **DONE** | `docs/evidence/phase-06/` |
| 7 | Load prove §5 | **DONE** GREEN | `docs/evidence/phase-07/` + `docs/bench/report-mw-20260719.md` |
| 8 | Harden + public HTTPS go-live | **DONE** | `docs/evidence/phase-08/` |
| 9 | Operate + data migrate finalize | **DONE** | `docs/evidence/phase-09/` |

---

## 5. Version map

| Artifact | Version |
| -------- | ------- |
| Upstream base | `decolua/9router` **0.5.35** |
| Live runtime release dir | **0.5.35-mw.4** |
| Git tags | `v0.5.35-mw.5` (ops harden), `v0.5.35-mw.6` (final docs + migration + public SSL evidence) |
| `VERSION` / `package.json` (repo) | **0.5.35-mw.6** |

Redeploy of app binary to mw.6 is **optional** (mw.6 is documentation/evidence + finalize; runtime features already live since mw.4).

---

## 6. Locked production invariants

1. Workers always **4** — no `WORKERS=1` production default  
2. Redis only **6381** — never 6379/6380  
3. SQLite only **better-sqlite3 + WAL**  
4. MITM **OFF** in production  
5. Bind **127.0.0.1:20128** behind Nginx  
6. No secrets in git  
7. No double-request (cluster is capacity, not fan-out)

---

## 7. Residual / optional follow-ups

- [ ] Optional real provider smoke at low QPS (credentials already in DB)  
- [ ] 24–48h operational watch (journal, disk, Redis RSS, worker RSS)  
- [ ] Create dashboard API keys on MW if clients need remote `/v1/*`  
- [ ] Optional full 30m soak (current waiver: 10m @ 100 VU — still GREEN)  
- [ ] Monthly upstream sync — `docs/runbooks/upstream-sync.md`

---

## 8. Document index (final)

| Path | Role |
| ---- | ---- |
| [`docs/RELEASE.md`](./RELEASE.md) | **This file** — final release status |
| [`docs/plans/9router-mw-production-plan.md`](./plans/9router-mw-production-plan.md) | SSOT architecture plan (LOCKED) |
| [`docs/runbooks/`](./runbooks/) | Deploy / rollback / backup / go-live / upstream-sync |
| [`docs/deploy/`](./deploy/) | systemd, nginx, env example, scripts |
| [`docs/bench/report-mw-20260719.md`](./bench/report-mw-20260719.md) | Load gate report |
| [`docs/evidence/phase-00` … `phase-09`](./evidence/) | Per-phase proofs |
| [`CHANGELOG.md`](../CHANGELOG.md) | Version history (mw section) |

---

## 9. Sign-off

| Role | Decision |
| ---- | -------- |
| Engineering F0–F9 | **ACCEPTED** |
| Load §5 | **GREEN** (+ soak waiver documented) |
| DNS + public HTTPS | **LIVE** |
| Provider data (non-mimo) + custom nodes + proxy pools | **MIGRATED** |
| Production final rilis docs | **COMPLETE** |

**Public production date:** 2026-07-19  
**Owner:** fazulfi / 9router-MW
