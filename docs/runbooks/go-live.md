# Runbook — Go-live checklist

## Architecture (locked)

CF → Nginx `router.budgezen.com` → `127.0.0.1:20128` → **4** workers (`cluster.fork`)  
Redis **only** `127.0.0.1:6381` · SQLite better-sqlite3+WAL · MITM **OFF**

## Pre-flight

- [x] DNS A `router` → 82.25.62.204 (Cloudflare Proxied) — verified 2026-07-19
- [x] Nginx site enabled, SSL OK (Cloudflare Origin CA), not default_server
- [x] Cloudflare SSL/TLS mode: **Full (strict)**
- [x] `systemctl is-enabled 9router-mw` + active
- [x] Health: 4 workers, redis ok, undici enabled, journal_mode wal
- [x] Foreign services healthy (6379/6380) — per deploy evidence
- [x] Backup cron installed; one manual backup OK
- [x] logrotate installed
- [x] Rollback script dry-run documented
- [x] Load report §5 GREEN (`docs/bench/report-mw-20260719.md`)

## Go-live (public edge)

1. [x] Tag release `v0.5.35-mw.5` (ops harden) + `v0.5.35-mw.6` (final docs + migration)
2. [x] Public HTTPS: `https://router.budgezen.com/api/health` → **200** (2026-07-19)
3. [x] API key policy for remote `/v1/*` enforced (`401` without key)
4. [x] Provider data migrated (non-mimo connections + custom nodes + proxy pools + combos + model kv) — `docs/evidence/phase-09/`
5. [ ] Low-QPS real provider smoke (optional; credentials in DB)
6. [ ] Monitor 24–48h: journalctl, disk, redis memory, worker RSS

## Public verify commands

```bash
curl -sS https://router.budgezen.com/api/health
# expect ok:true, workers:4, redis.ok, undici, better-sqlite3/wal

curl -sS https://router.budgezen.com/v1/models
# expect 401 API key required (without Authorization)
```

## Final status

See **`docs/RELEASE.md`** — PRODUCTION FINAL 2026-07-19.

## Abort

Rollback to previous release id via `docs/runbooks/rollback.md`.
