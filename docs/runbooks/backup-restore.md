# Runbook — Backup & restore

## Backup (automatic)

- Cron: `/etc/cron.d/9router-mw` → daily 03:17 UTC  
- Script: `/usr/local/sbin/backup-9router-mw.sh`  
- Output: `/var/lib/9router-mw/backups/9router-mw-YYYYMMDDTHHMMSSZ.tgz`  
- Retain: 7 days  

Manual:

```bash
/usr/local/sbin/backup-9router-mw.sh
```

## Restore SQLite

1. Stop service: `systemctl stop 9router-mw`
2. Extract backup to temp, copy `data.sqlite` (+ wal if present) into `/var/lib/9router-mw/db/`
3. `chown -R router:router /var/lib/9router-mw/db`
4. `systemctl start 9router-mw`
5. Health smoke + dashboard login

## Secrets

- `/etc/9router-mw/env` is **not** fully stored in backups (redacted). Keep offline copy of real env.
