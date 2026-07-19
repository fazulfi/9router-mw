# Phase-08 Evidence — Production harden & go-live

**Tag (ops harden):** `v0.5.35-mw.5`  
**Tag (final docs):** `v0.5.35-mw.6`  
**HEAD scripts (harden):** `a6485ce4`  
**Live app release:** `0.5.35-mw.4` (hotpath); ops tools from mw.5+

## Exit — MET

| Item | Result |
|------|--------|
| logrotate | `/etc/logrotate.d/9router-mw` installed |
| backup cron | `/etc/cron.d/9router-mw` + `/usr/local/sbin/backup-9router-mw.sh` |
| backup run | `9router-mw-20260719T010030Z.tgz` |
| rollback drill | mw.4→mw.3 **2770ms**, restore mw.4 **2758ms** (<2 min) |
| systemd | active + enabled |
| health | 4 workers, redis ok, undici, wal |
| runbooks | deploy/rollback/backup/go-live/upstream-sync |
| tag | `v0.5.35-mw.5` on origin |
| foreign redis | 6379/6380 untouched |
| public HTTPS | **200** after Origin CA — see `01-public-https-golive.md` |

## Artifacts

00-start, 01-scripts-head, **01-public-https-golive.md**, 02-logrotate-*, 03-backup-*, 04-rollback-*, 05-health, 06-foreign-ok, 07-runbooks, 99-done

## Status

**Phase-08 COMPLETE** including public edge go-live (DNS + Origin CA SSL).
