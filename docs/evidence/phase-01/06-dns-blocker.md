# DNS blocker — router.budgezen.com

**Status:** BLOCKER for public go-live (Fase 8). Nginx site can be prepared earlier.

**Required (user action in Cloudflare, zone budgezen.com):**

| Name | Type | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| router | A | 82.25.62.204 | Proxied (orange cloud) | Auto |

Optional later:
| router-staging | A | 82.25.62.204 | DNS only (grey) | Auto |

**Verify after create:**
```bash
dig +short router.budgezen.com A
# expect Cloudflare anycast IPs if proxied, or 82.25.62.204 if DNS-only
curl -sI https://router.budgezen.com/health
```

**Risk note (plan §3.6):** Cloudflare free SSE timeout ~100s may cut long streams.
Mitigation at go-live: client reconnect OR grey-cloud for long SSE if critical.

**Owner:** user (Cloudflare access). Agent cannot create CF DNS without API token.
**Logged:** phase-01 F1.6 2026-07-19
