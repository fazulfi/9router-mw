# Phase-08 — Public HTTPS go-live evidence

**Date:** 2026-07-19
**Host:** example.com → Cloudflare Proxied → origin [REDACTED-VPS]

## Before

- DNS A `router` Proxied OK
- App health local OK (4 workers, redis, undici, WAL)
- Public `https://example.com/*` → **Cloudflare 526**
- Root cause: nginx used self-signed `existing-default.crt` (CN=existing-default.local)

## Action

1. User created Cloudflare Origin Certificate (SAN includes `example.com`)
2. User confirmed SSL/TLS encryption mode: **Full (strict)**
3. Agent installed on VPS:
 - `/etc/nginx/ssl/example.com.crt` (644)
 - `/etc/nginx/ssl/example.com.key` (600)
4. Nginx site updated to new cert paths; `nginx -t` OK; `systemctl reload nginx`
5. Cert/key modulus match verified; RSA key ok
6. Local temp cert/key files cleaned after install

## After (public)

| URL | Result |
|-----|--------|
| `https://example.com/api/health` | **200** JSON `ok:true`, workers:4, redis ready, undici, better-sqlite3/wal |
| `https://example.com/` | **307** → `/dashboard` |
| `https://example.com/v1/models` | **401** `API key required for remote API access` (expected) |

## Status

- Public edge SSL: **GREEN**
- Production public URL live
- Data migration + final docs: see phase-09 + `docs/RELEASE.md` (tag `v0.5.35-mw.6`)
- Remaining ops (non-blocking docs): optional provider smoke + 24–48h watch
