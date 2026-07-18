# Phase 04 — Redis shared state (Fase 4)

## Goal

Cross-worker shared state on dedicated Redis `127.0.0.1:6381` only:

- `open-sse/services/redisClient.js` — ioredis, fail-open
- `accountSemaphore.js` — `mw:sem:{accountId}`
- `circuitBreaker.js` — `mw:cb:{accountId}`
- `usageBuffer.js` — `mw:usage:queue`
- Concurrent claim test: max=1 → exactly one winner
- `/api/health` exposes `redis` field

## Exit criteria (plan)

- [ ] Modules present in release + standalone
- [ ] ioredis installed; workers can PING Redis 6381
- [ ] Health samples: `redis.ok` majority + rotating `workerId`
- [ ] `mw-concurrent-claim.mjs` PASS (no double-claim)
- [ ] Foreign redis 6379/6380 untouched
- [ ] Version `0.5.35-mw.2` deployed
- [ ] k6 smoke no 502 storm

## Deploy

```bash
# as root on VPS after push
scp docs/deploy/f4-deploy-redis.sh root@82.25.62.204:/tmp/
ssh root@82.25.62.204 'bash /tmp/f4-deploy-redis.sh'
```

## Evidence files (fill after deploy)

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
