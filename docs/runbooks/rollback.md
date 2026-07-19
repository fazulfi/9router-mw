# Runbook — Rollback

## Fast path (< 2 minutes)

```bash
# list releases
ls /opt/9router-mw/releases

# rollback to previous release id
/usr/local/sbin/rollback-9router-mw.sh 0.5.35-mw.3
```

Script: `docs/deploy/rollback-9router-mw.sh` (installed to `/usr/local/sbin/`).

## Manual

```bash
ln -sfn /opt/9router-mw/releases/<id>/.next/standalone /opt/9router-mw/current
systemctl restart 9router-mw
curl -s http://127.0.0.1:20128/api/health
```

## Data

- SQLite lives in `/var/lib/9router-mw/db` (not inside release tree) — rollback does **not** wipe credentials.
- Daily backups: `/var/lib/9router-mw/backups/9router-mw-*.tgz`

## If Redis MISCONF

```bash
chown -R 999:999 /var/lib/9router-mw/redis
chmod 700 /var/lib/9router-mw/redis
docker restart 9router-mw-redis
systemctl restart 9router-mw
```
