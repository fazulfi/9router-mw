# Runbooks — 9router-mw

Operational procedures for production gateway.

| Runbook | Purpose |
| ------- | ------- |
| [deploy.md](./deploy.md) | Deploy / restart workers |
| [rollback.md](./rollback.md) | Rollback to previous release |
| [backup-restore.md](./backup-restore.md) | Daily backup + restore SQLite |
| [go-live.md](./go-live.md) | Go-live checklist |
| [upstream-sync.md](./upstream-sync.md) | Monthly upstream merge (F9) |

Domain: `router.budgezen.com`  
Listen: `127.0.0.1:20128` (systemd User=router)  
Redis: `127.0.0.1:6381` only  
Workers: always 4 via `cluster.fork`  
