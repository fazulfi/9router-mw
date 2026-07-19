# Phase-05 Evidence — F5 Resilience Wire

**Version:** `0.5.35-mw.3`
**Release HEAD:** `2930903c` (evidence commit `edb1c887`)
**VPS:** user@[REDACTED-VPS] / `/opt/9router-mw/releases/0.5.35-mw.3`
**Goal:** Wire F4 Redis semaphore + circuit breaker into chat account loop; settings cache 5s TTL.

## Exit criteria — MET

| Check | Result | Evidence |
|-------|--------|----------|
| Research MD | OK | `docs/execution/F5-research-wire-points.md` |
| chat.js wire (breaker→sem→try/finally) | OK | `02-chat-wire.txt` |
| settingsRepo 5s cache + invalidate | OK | `02-settings-cache.txt` |
| Version 0.5.35-mw.3 | OK | `02-version.txt` |
| 4 workers | PASS_FOUR | `08-processes.txt`, `22-health-analysis.txt` |
| Redis health after fix | PASS_REDIS 20/20 | `22-health-analysis.txt` |
| Concurrent claim max=1 | 5/5 PASS | `23-claim-test.txt` |
| k6 smoke | 9319 reqs, 0% fail, ~620 rps | `14-k6-smoke.txt` |
| Foreign redis untouched | 6379/6380 healthy | `24-foreign-ok.txt` |

## Incident: Redis MISCONF during first smoke

**Symptom:** `redis_ok_count 0` / `mode=degraded`; claim test FAIL with `MISCONF ... RDB ... Permission denied` on `/data`.

**Root cause:** host volume `/var/lib/9router-mw/redis` owned by `router` (uid 987); Redis container runs as uid **999** → cannot write `temp-*.rdb`.

**Fix applied (ops, not app code):**

1. `chown -R 999:999 /var/lib/9router-mw/redis` + `chmod 700`
2. `CONFIG SET stop-writes-on-bgsave-error no` (runtime)
3. `systemctl restart 9router-mw`
4. Re-smoke: PASS_REDIS + claim 5/5

See `20-redis-fix.txt` … `25-redis-fix-done.txt`.

**Follow-up for F8:** bake `chown 999:999` into Redis bootstrap/runbook so RDB works after reboot without manual fix.

## Code review checklist

- [x] OPEN accounts never enter chatCore (getBreakerState allow gate)
- [x] Semaphore always released in `finally`
- [x] noauth path skips Redis claim
- [x] 429 excluded from `recordBreakerFailure`
- [x] Settings cache TTL 5s; update + importDb invalidate
- [x] No Vans ACL/ponytail/dashboard ported
- [x] Redis only `127.0.0.1:6381`
- [x] Health `{ok, workerId, pid, workers, redis}`
- [x] Deploy: 4 workers, PASS_REDIS, k6 no 502

## Artifact index

| File | Content |
|------|---------|
| 00–14 | deploy, build, health pre-fix (degraded), k6 |
| 20–25 | redis volume fix + re-smoke PASS |
| 99-done.txt | deploy script complete |
