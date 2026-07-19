# 9router-MW Architecture (Production)

> **Status:** PRODUCTION FINAL 2026-07-19  
> **Full release status:** [`docs/RELEASE.md`](./RELEASE.md)  
> **Upstream base architecture:** [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) (stock 9router)  
> **Plan SSOT:** [`docs/plans/9router-mw-production-plan.md`](./plans/9router-mw-production-plan.md)

## Production topology

```text
Internet clients
    → Cloudflare (DNS Proxied + TLS edge)
    → Nginx :443 (Origin CA, Full strict)
    → 127.0.0.1:20128  Node primary (cluster)
         ├─ worker 1
         ├─ worker 2
         ├─ worker 3
         └─ worker 4
              ├─ undici keep-alive Agent → upstream providers
              ├─ Redis 127.0.0.1:6381 → semaphore, breaker, usage buffer
              └─ SQLite WAL /var/lib/9router-mw → source of truth
MITM: OFF
```

## Double-request model

**No fan-out.** Kernel/LB delivers each TCP/HTTP request to **exactly one** worker.  
That worker performs **one** upstream call (except intentional combo/account fallback sequences, which are product behavior, not cluster multiplication).

Proven: mock upstream request count == k6 client request count (phase-07).

## Key process paths

| Path | Role |
| ---- | ---- |
| `custom-server.js` | cluster primary + workers, real client IP |
| `open-sse/` | chat core, executors, translator, RTK |
| Redis services | account claim / circuit breaker / usage queue |
| better-sqlite3 | credentials, settings, usage history (WAL) |

## Health contract

`GET /api/health` returns:

- `ok`, `workers: 4`, `workerId`, `pid`
- `redis.ok` / latency
- `hotpath.undici` pool settings
- `hotpath.sqlite.driver=better-sqlite3`, `journalMode=wal`

## Invariants (never violate in prod)

1. Workers = 4 always  
2. Redis only port 6381  
3. better-sqlite3 + WAL only (no sql.js)  
4. Bind localhost only; public via Nginx  
5. No secrets in git  
6. Foreign stacks (6379/6380) untouched  
