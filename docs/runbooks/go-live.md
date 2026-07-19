# Runbook — Go-live checklist

## Architecture (locked)

CF → Nginx `router.budgezen.com` → `127.0.0.1:20128` → **4** workers (`cluster.fork`)  
Redis **only** `127.0.0.1:6381` · SQLite better-sqlite3+WAL · MITM **OFF**

## Pre-flight

- [ ] DNS A `router` → 82.25.62.204 (Cloudflare)
- [ ] Nginx site enabled, SSL OK, not default_server
- [ ] `systemctl is-enabled 9router-mw` + active
- [ ] Health: 4 workerIds, redis ok, undici enabled, journal_mode wal
- [ ] Foreign services healthy (6379/6380)
- [ ] Backup cron installed; one manual backup OK
- [ ] logrotate installed
- [ ] Rollback script dry-run documented
- [ ] Load report §5 GREEN (`docs/bench/report-mw-20260719.md`)

## Go-live

1. Tag release `v0.5.35-mw.5` (or current VERSION)
2. Confirm API key policy for `/v1/*`
3. Low-QPS real provider smoke (optional if credentials configured)
4. Monitor 24–48h: journalctl, disk, redis memory, worker RSS

## Abort

Rollback to previous release id via `docs/runbooks/rollback.md`.
