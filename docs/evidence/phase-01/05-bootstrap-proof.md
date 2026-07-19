# phase-01 post-bootstrap proof (NO SECRETS)
timestamp_utc: 2026-07-18T23:08:43Z
host: [REDACTED-HOST] (user@[REDACTED-VPS])

## F1.1 Audit result
- 20128: FREE (pre-bootstrap)
- 6381: FREE (pre) → now 9router-mw-redis
- 6379: ggl-redis (NOAUTH required) UNTOUCHED
- 6380: app-redis-1 (PONG) UNTOUCHED
- CPU 4, RAM 15Gi, disk 83G free
- nginx active; sites: [CO-TENANT-A], [CO-TENANT-B-ts], [CO-TENANT-B-webhook]
- node v20.20.2 / npm 10.8.2
- build-essential + python3 present

## F1.2 user + dirs
- user router: uid=987 gid=980 home=/home/router
- /opt/9router-mw/{releases,shared} owner router:router
- /var/lib/9router-mw/{db,tokens,logs,backups,redis} mode 0700 root path
- /etc/9router-mw mode 0750 root:router
- /var/log/9router-mw mode 0750 router:router
- /etc/9router-mw/env mode 0640 root:router (keys only in git evidence)

## F1.3 sudoers
- /etc/sudoers.d/9router-mw parsed OK
- limited systemctl start|stop|restart|status 9router-mw, reload nginx, journalctl -u 9router-mw

## F1.4 Redis dedicated
- container: 9router-mw-redis (redis:7.4-alpine)
- bind: 127.0.0.1:6381->6379/tcp
- requirepass: YES (PONG with auth; NOAUTH without)
- maxmemory 256mb, allkeys-lru, RDB save 900 1
- data volume: /var/lib/9router-mw/redis
- env REDIS_* written to /etc/9router-mw/env (NOT in git)

## F1.5 Swap
- /swapfile 2G created, swapon active, fstab entry present
- foreign services still healthy (ggl-redis, app-redis-1)

## Isolation checklist
[x] no public bind 20128/6381
[x] no touch ggl-redis / app-redis-1
[x] password not committed
