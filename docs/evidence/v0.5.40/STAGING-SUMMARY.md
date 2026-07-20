# v0.5.40-mw.0 Staging Evidence Summary

**Date:** 2026-07-20
**Branch:** `integration/v0.5.40` @ `196cfc80`
**Plan:** `.sisyphus/plans/9router-mw-upstream-v0.5.40-production.md`
**Outcome:** **STAGING GREEN** (all gates pass), **PRODUCTION UNTOUCHED**

---

## TL;DR

| Gate | Target | Result |
|------|--------|--------|
| Staging health (5 rapid calls) | 200, ok:true, workers:4, redis ok, undici, wal | **PASS** (5/5) |
| Unique workerIds | ≥ 2 (proof of cluster) | **PASS** (`['1','2','3','4']`) |
| Staging Redis ping | PONG | **PASS** |
| Staging concurrent claim (5 rounds) | no double-claim | **PASS** (5/5 rounds) |
| Staging k6 smoke (20 VU x 15s) | 0% error | **PASS** (0% fail, 100% checks, ~579 rps) |
| Production health (post-staging) | 200, workers:4, redis ok | **PASS** (untouched) |
| Foreign Redis (ggl, app) | untouched | **PASS** |
| Docker volume prune | not executed | **PASS** (no global prune) |

**Residual:** Health response does not include a top-level `version` field (plan §3.8 aspirational; production has the same behavior — not a regression). All actual contract checks (workerId, redis, undici, sqlite/wal) pass.

---

## Staging topology

| | Production | Staging |
|--|-----------|---------|
| App port | 127.0.0.1:20128 | 127.0.0.1:20129 |
| Redis port | 127.0.0.1:6381 | 127.0.0.1:6382 |
| App root | /opt/9router-mw | /opt/9router-mw-staging |
| Data | /var/lib/9router-mw | /var/lib/9router-mw-staging |
| Config | /etc/9router-mw | /etc/9router-mw-staging |
| Service | 9router-mw | 9router-mw-staging |
| Redis container | 9router-mw-redis | 9router-mw-redis-staging |
| User | router | router |
| Version | 0.5.35-mw.7 | **0.5.40-mw.0** |
| Workers | 4 | **4** |
| Bind | 127.0.0.1 | 127.0.0.1 |

---

## Evidence files

| File | Content |
|------|---------|
| `00-start.txt` | Provision start time, branch, release id, ports |
| `02-git-head.txt` | Staging HEAD = `196cfc80` on `integration/v0.5.40` |
| `02-commit-diffs.txt` | (pre-existing) Cherry-pick diff stats |
| `03-staging-health.json` | 5 rapid health calls (200, ok:true, multi-worker, redis ok, undici, wal) |
| `03-staging-health-raw.txt` | Raw health responses |
| `03-invariants.txt` | (pre-existing) Invariants list |
| `04-staging-socket.txt` | `ss -tlnp` for 20129 |
| `04-modified-files.txt` | (pre-existing) Files modified in cherry-picks |
| `05-staging-redis.txt` | `docker ps` for `9router-mw-redis-staging` + PING |
| `05-version.txt` | (pre-existing) Version record |
| `06-staging-smoke.txt` | Full smoke output (health, claim, k6, foreign) |
| `06-conflict-check.txt` | (pre-existing) Conflict check |
| `07-chatcore-review.txt` | chatCore.js MW-integration signal check |
| `08-production-healthy-post-staging.txt` | Production still 200/4/redis/undici/wal |
| `13-foreign-ok.txt` | ggl-redis, app-redis-1, 9router-mw-redis (prod) untouched |
| `14-k6-staging-summary.json` | k6 summary export (20 VU, 15s, 0% fail) |
| `99-done.txt` | Capture-done marker |

---

## Health samples (5 rapid calls, raw)

```json
{"ok":true,"workerId":"2","pid":2769172,"workers":4,"redis":{"ok":true,"mode":"redis","latencyMs":24,...},"hotpath":{"undici":{"enabled":true,"connections":32,"pipelining":1,"keepAliveTimeout":30000,"keepAliveMaxTimeout":60000},"sqlite":{"driver":"better-sqlite3","journalMode":"wal"}}}
{"ok":true,"workerId":"4","pid":2769179,"workers":4,"redis":{"ok":true,"mode":"redis","latencyMs":12,...},"hotpath":{"undici":{"enabled":true,"connections":32,"pipelining":1,"keepAliveTimeout":30000,"keepAliveMaxTimeout":60000},"sqlite":{"driver":"better-sqlite3","journalMode":"wal"}}}
{"ok":true,"workerId":"1","pid":2769171,"workers":4,"redis":{"ok":true,"mode":"redis","latencyMs":12,...},"hotpath":{"undici":{"enabled":true,"connections":32,"pipelining":1,"keepAliveTimeout":30000,"keepAliveMaxTimeout":60000},"sqlite":{"driver":"better-sqlite3","journalMode":"wal"}}}
{"ok":true,"workerId":"3","pid":2769173,"workers":4,"redis":{"ok":true,"mode":"redis","latencyMs":13,...},"hotpath":{"undici":{"enabled":true,"connections":32,"pipelining":1,"keepAliveTimeout":30000,"keepAliveMaxTimeout":60000},"sqlite":{"driver":"better-sqlite3","journalMode":"wal"}}}
{"ok":true,"workerId":"2","pid":2769172,"workers":4,"redis":{"ok":true,"mode":"redis","latencyMs":1,...},"hotpath":{"undici":{"enabled":true,"connections":32,"pipelining":1,"keepAliveTimeout":30000,"keepAliveMaxTimeout":60000},"sqlite":{"driver":"better-sqlite3","journalMode":"wal"}}}
```

**Analysis:**
- samples: 5, ok_count: 5
- unique_workerIds: `['1', '2', '3', '4']` (4 unique = full cluster)
- redis_ok_count: 5/5
- undici_ok_count: 5/5
- sqlite_drivers: `{better-sqlite3: 5}`
- journal_modes: `{wal: 5}`
- PASS_MULTI, PASS_FOUR, PASS_REDIS, PASS_UNDICI, PASS_NATIVE_SQLITE, PASS_WAL

---

## Concurrent claim test (5 rounds)

```
{"REDIS_URL":"[set]","REDIS_HOST":"127.0.0.1","REDIS_PORT":"6382","REDIS_PASSWORD":"[set]","ROUNDS":5,"KEY_PREFIX":"mw:sem:"}
redis_ping PONG
{"round":1,...,"winners":1} {"round":2,...,"winners":1} {"round":3,...,"winners":1} {"round":4,...,"winners":1} {"round":5,...,"winners":1}
PASS: no double-claim across concurrent acquires (max=1, Redis mw:sem:*)
```

5/5 rounds passed. No double-claim. Exit 0.

---

## k6 light smoke (20 VU x 15s)

```
checks_total: 34764 (2314/s)
checks_succeeded: 100.00%
checks_failed: 0.00%
http_req_failed: 0.00%  (0 of 8691)
http_reqs: 8691 (578.7/s)
http_req_duration p(95): 69.86ms
```

All 4 checks (`status 200`, `ok true`, `has workerId`, `has redis`) passed 100%.

---

## Production health post-staging (untouched)

```
prod_http=200
prod_ok=True workers=4 redis_ok=True undici=True sqlite=better-sqlite3/wal
LISTEN 127.0.0.1:20128  (production node)
LISTEN 127.0.0.1:6381   (production docker-proxy)
9router-mw-redis          Up 127.0.0.1:6381->6379/tcp
9router-mw-redis-staging  Up 127.0.0.1:6382->6379/tcp  (NEW)
ggl-redis                 Up 127.0.0.1:6379->6379/tcp  (untouched)
app-redis-1               Up 127.0.0.1:6380->6379/tcp  (untouched)
```

---

## Scripts added (committed on integration/v0.5.40)

| File | Purpose |
|------|---------|
| `scripts/stage-upstream-v0.5.40.sh` | Idempotent staging provision (build + assemble + start) |
| `scripts/tests/staging-smoke-v0.5.40.sh` | Health gate + concurrent claim + k6 smoke |
| `scripts/stage-cleanup-v0.5.40.sh` | Removes only staging service/container/paths (no global prune) |
| `scripts/stage-env.v0.5.40.template` | Staging env template (no real values) |
| `scripts/stage-9router-mw.v0.5.40.service` | Systemd unit template |

---

## Promotion safety

| Question | Answer |
|----------|--------|
| Are all staging gates green? | **YES** (health, multi-worker, redis, undici, sqlite/wal, concurrent claim, k6) |
| Is production still healthy? | **YES** (200, 4 workers, redis ok, undici, wal) |
| Are foreign services untouched? | **YES** (ggl-redis, app-redis-1, all volumes intact) |
| Are secrets isolated? | **YES** (staging has independent JWT/API_KEY/PASSWORD/REDIS_PASSWORD) |
| Is the staging env clean of production ports? | **YES** (PORT=20129, REDIS_PORT=6382) |
| Was `docker volume prune` executed? | **NO** (volumes untouched) |

**Verdict:** **SAFE TO PROCEED** with the production promotion gate (Task 4.x), assuming the production gate checklist is run next. **This task (3.5–3.8) does NOT promote production** — that is a separate phase per the plan.
