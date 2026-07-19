# Phase-08 — Public HTTPS go-live evidence

**Date:** 2026-07-19  
**Host:** router.budgezen.com → Cloudflare Proxied → origin 82.25.62.204

## Before

- DNS A `router` Proxied OK
- App health local OK (4 workers, redis, undici, WAL)
- Public `https://router.budgezen.com/*` → **Cloudflare 526**
- Root cause: nginx used self-signed `gomerch.crt` (CN=gomerch.local)

## Action

1. User created Cloudflare Origin Certificate (SAN includes `router.budgezen.com`)
2. User confirmed SSL/TLS encryption mode: **Full (strict)**
3. Agent installed on VPS:
   - `/etc/nginx/ssl/router.budgezen.com.crt` (644)
   - `/etc/nginx/ssl/router.budgezen.com.key` (600)
4. Nginx site updated to new cert paths; `nginx -t` OK; `systemctl reload nginx`
5. Cert/key modulus match verified; RSA key ok
6. Local temp cert/key files cleaned after install

## After (public)

| URL | Result |
|-----|--------|
| `https://router.budgezen.com/api/health` | **200** JSON `ok:true`, workers:4, redis ready, undici, better-sqlite3/wal |
| `https://router.budgezen.com/` | **307** → `/dashboard` |
| `https://router.budgezen.com/v1/models` | **401** `API key required for remote API access` (expected) |

## Status

- Public edge SSL: **GREEN**
- Production public URL live
- Data migration + final docs: see phase-09 + `docs/RELEASE.md` (tag `v0.5.35-mw.6`)
- Remaining ops (non-blocking docs): optional provider smoke + 24–48h watch
