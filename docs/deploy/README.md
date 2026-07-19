# Deploy — 9router-mw

Deployment artifacts and templates (no live secrets).

**Final status:** [`docs/RELEASE.md`](../RELEASE.md) · tag `v0.5.35-mw.7`
**Live app release:** `0.5.35-mw.7` under `/opt/9router-mw/releases/` (rollback: `0.5.35-mw.4`)

## Targets

| Item | Value |
| ---- | ----- |
| VPS | user@[REDACTED-VPS] ([REDACTED-HOST]) |
| App user | router |
| App dir | /opt/9router-mw |
| Data | /var/lib/9router-mw |
| Config | /etc/9router-mw |
| Bind | 127.0.0.1:20128 |
| Workers | always 4 via cluster.fork |
| Redis | 127.0.0.1:6381 (Docker dedicated) |
| Domain | example.com |
| Public health | https://example.com/api/health |

## Contents

| Artifact | Purpose |
| -------- | ------- |
| `9router-mw.service` | systemd unit |
| `nginx-example.com.conf` | edge site (Origin CA paths) |
| `env.example` | env template (no secrets) |
| `DNS-CLOUDFLARE-BLOCKER.md` | DNS+SSL status (**RESOLVED**) |
| `logrotate-9router-mw` | logrotate snippet |
| `cron-9router-mw` | daily backup cron |
| `backup-9router-mw.sh` | backup script |
| `rollback-9router-mw.sh` | rollback script |
| `f2`–`f8-*.sh` | phase deploy scripts (historical) |

## Ops commands (summary)

```bash
systemctl status 9router-mw
curl -sS http://127.0.0.1:20128/api/health
curl -sS https://example.com/api/health
# backup
/usr/local/sbin/backup-9router-mw.sh
# rollback
/usr/local/sbin/rollback-9router-mw.sh <prev-release-id>
```

Full procedures: [`docs/runbooks/`](../runbooks/).
