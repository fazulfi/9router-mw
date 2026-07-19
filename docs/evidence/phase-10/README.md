# Phase 10 — Formal deploy `0.5.35-mw.7`

**Date:** 2026-07-19  
**Host:** root@82.25.62.204 (faiz-prod-01)  
**Status:** **DONE**

## Goal

Promote production from hotpatched `0.5.35-mw.4` to formal release directory **`0.5.35-mw.7`** (tag `v0.5.35-mw.7`, HEAD `a892527f`).

## Procedure

1. Pre-backup SQLite → `/var/lib/9router-mw/db/backups/pre-mw7-deploy-*`
2. `RELEASE_ID=0.5.35-mw.7` via `docs/deploy/f6-deploy-hotpath.sh`
3. `git clone --depth 1` → npm install → `next build` → assemble standalone
4. `ln -sfn` current → `.../0.5.35-mw.7/.next/standalone`
5. `systemctl restart 9router-mw`
6. Health + k6 smoke + Redis `mw:live:*` verify

## Result (post-deploy)

| Check | Result |
| ----- | ------ |
| `current` | `/opt/9router-mw/releases/0.5.35-mw.7/.next/standalone` |
| `VERSION` | `0.5.35-mw.7` |
| systemd | **active** |
| workers | **4** (rotation 1–4) |
| redis | ok `:6381` |
| undici | enabled |
| sqlite | better-sqlite3 + **WAL** |
| liveUsage | `open-sse/services/liveUsageState.js` present; chunk has `mw:live:` |
| Redis keys | `mw:live:recent` LLEN=50, `mw:live:lastErr` |
| public | https://router.budgezen.com/api/health **200** |
| data | connections 13727, nodes 3, proxies 65, combos 8, mimo 0 |
| foreign | ggl-redis 6379 / app-redis 6380 **untouched** |
| rollback | `0.5.35-mw.4` standalone still on disk |
| k6 smoke | 20 VU / 15s — **9171** reqs, **0%** fail, p95 ~68ms health |

## Evidence on VPS

- `/tmp/9router-mw-mw7-deploy/` (F6 evidence tree)
- `/tmp/mw7-deploy-run.log`
- DB backup `pre-mw7-deploy-20260719T091927Z*`

## Artifacts

- [01-post-deploy-verify.txt](./01-post-deploy-verify.txt)
- [99-done.txt](./99-done.txt)
