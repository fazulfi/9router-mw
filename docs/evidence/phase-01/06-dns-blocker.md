# DNS blocker — example.com

**Status:** BLOCKER for public go-live (Fase 8). Nginx site can be prepared earlier.

**Required (user action in Cloudflare, zone example.com):**

| Name | Type | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| router | A | [REDACTED-VPS] | Proxied (orange cloud) | Auto |

Optional later:
| router-staging | A | [REDACTED-VPS] | DNS only (grey) | Auto |

**Verify after create:**
```bash
dig +short example.com A
# expect Cloudflare anycast IPs if proxied, or [REDACTED-VPS] if DNS-only
curl -sI https://example.com/health
```

**Risk note (plan §3.6):** Cloudflare free SSE timeout ~100s may cut long streams.
Mitigation at go-live: client reconnect OR grey-cloud for long SSE if critical.

**Owner:** user (Cloudflare access). Agent cannot create CF DNS without API token.
**Logged:** phase-01 F1.6 2026-07-19
