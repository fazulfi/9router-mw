# DNS + SSL — router.budgezen.com

**Status (2026-07-19):** RESOLVED for public edge.

## DNS (user — Cloudflare zone `budgezen.com`)

| Name | Type | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| router | A | 82.25.62.204 | Proxied (orange cloud) | Auto |

Verified: resolves to Cloudflare anycast (`104.21…` / `172.67…`), not bare origin IP.

## SSL (edge)

| Item | Value |
|------|--------|
| Cloudflare mode | **Full (strict)** |
| Origin cert | Cloudflare Origin CA |
| SAN | `router.budgezen.com`, `*.budgezen.com`, `budgezen.com` |
| Validity | 2026-07-19 → 2041-07-15 |
| Nginx paths | `/etc/nginx/ssl/router.budgezen.com.crt` + `.key` |
| Site conf | `/etc/nginx/sites-available/router.budgezen.com` |

Previous blocker: nginx used self-signed `gomerch.crt` (`CN=gomerch.local`) → public **526**.  
Fixed: dedicated Origin CA cert installed + nginx reload.

## Public verify

```bash
curl -sS https://router.budgezen.com/api/health
# expect: {"ok":true,"workers":4,"redis":{"ok":true},...}
```

## Residual risk

- Cloudflare free SSE timeout ~100s may cut long streams.
  Mitigation: client reconnect OR grey-cloud for long SSE if critical.
- Private key must never be committed to git. Keep only on VPS (`chmod 600`).

**Owner history:** DNS user; origin cert install agent 2026-07-19.
