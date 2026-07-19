# Phase-05 Evidence — F5 Resilience Wire

**Version:** `0.5.35-mw.3`  
**Goal:** Wire F4 Redis semaphore + circuit breaker into chat account loop; settings cache 5s TTL.

## Checklist (exit criteria)

- [ ] Research MD: `docs/execution/F5-research-wire-points.md`
- [ ] `chat.js`: breaker → acquire → try/finally release; 429 excluded from breaker failure
- [ ] `settingsRepo.js`: 5s cache + invalidate on update
- [ ] `importDb`: invalidateSettingsCache after import
- [ ] Version files `0.5.35-mw.3`
- [ ] Deploy: 4 workers, PASS_REDIS, health ok
- [ ] Code review checklist in research MD all checked
- [ ] k6 smoke no 502 storm
- [ ] Foreign redis 6379/6380 untouched

## Artifacts (after deploy)

| File | Content |
|------|---------|
| 00-start.txt | timestamp |
| 02-git-head.txt | release HEAD |
| 02-version.txt | 0.5.35-mw.3 |
| 07-systemd-*.txt | service active |
| 08-processes.txt | 4 workers |
| 10-health-*.txt | workerId rotate + redis |
| 11-claim-test.txt | concurrent claim PASS |
| 14-k6-smoke.txt | load smoke |
| 99-done.txt | complete |

## Code review (fill after deploy)

- [ ] OPEN accounts never hit chatCore
- [ ] Semaphore always released in finally
- [ ] noauth unchanged
- [ ] No Vans ACL/ponytail ported
