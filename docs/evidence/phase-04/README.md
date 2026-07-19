# Phase 04 — Redis shared state (Fase 4)

## Goal

Cross-worker shared state on dedicated Redis `127.0.0.1:6381` only:

- `open-sse/services/redisClient.js` — ioredis, fail-open
- `accountSemaphore.js` — `mw:sem:{accountId}`
- `circuitBreaker.js` — `mw:cb:{accountId}`
- `usageBuffer.js` — `mw:usage:queue`
- Concurrent claim test: max=1 → exactly one winner
- `/api/health` exposes `redis` field

## Exit criteria (plan) — COMPLETE 2026-07-19T00:03:15Z

- [x] Modules present in release + standalone
- [x] ioredis installed; workers can PING Redis 6381
- [x] Health samples: `redis.ok` majority + rotating `workerId`
- [x] `mw-concurrent-claim.mjs` PASS (no double-claim)
- [x] Foreign redis 6379/6380 untouched
- [x] Version `0.5.35-mw.2` deployed
- [x] k6 smoke no 502 storm

## Deploy proof summary

| Check | Result |
| ----- | ------ |
| Release | `/opt/9router-mw/releases/0.5.35-mw.2` HEAD `c9beae38` |
| Workers | 4 PIDs: 496928, 496929, 496930, 496936 (primary 496918) |
| Health 20 samples | workerIds 1–4 each 5×; `redis_ok_count 20`; PASS_MULTI PASS_FOUR PASS_REDIS |
| Claim test | 5/5 rounds PASS — no double-claim max=1 |
| k6 smoke 20VU×15s | 9905 reqs, 0% fail, ~659 rps, checks 100% (status/ok/workerId/redis) |
| Foreign redis | ggl 6379 + app 6380 healthy; MW 6381 only |

## Deploy

```bash
# as root on VPS after push
scp docs/deploy/f4-deploy-redis.sh root@82.25.62.204:/tmp/
ssh root@82.25.62.204 'bash /tmp/f4-deploy-redis.sh'
```

## Evidence files

| File | Content |
| ---- | ------- |
| `00-start.txt` | deploy start |
| `01-env.txt` / `01-redis-*` | env + redis docker ping |
| `02-git-head.txt` / `02-modules.txt` | release HEAD + modules |
| `03-npm-install.txt` / `04-build.txt` | install + build |
| `05-*` / `06-current-link.txt` | standalone assemble |
| `07-systemd-*` | service status |
| `08-processes.txt` | 4 workers |
| `10-health-*` | health + redis analysis |
| `11-claim-test.txt` | concurrent claim PASS |
| `13-foreign-ok.txt` | isolation |
| `14-k6-smoke.txt` | load smoke |

## Note

F4 builds modules + synthetic claim test. **F5** wires chatCore + Vans settings cache (5s).
