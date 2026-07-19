# Phase-09 — Operate + finalize (execution log)

**Date:** 2026-07-19 (Asia/Bangkok)  
**Status:** COMPLETE  
**Tag:** `v0.5.35-mw.6`

## Objectives

1. Confirm public edge remains GREEN after DNS/SSL go-live  
2. Migrate production provider data from legacy VPS (exclude mimo)  
3. Migrate custom provider nodes, proxy pools, combos, model alias KV  
4. Publish final release documentation set  

## Work performed

### Public edge (carry-over from phase-08)

- Cloudflare DNS `router` A → 82.25.62.204 Proxied  
- Origin CA installed; nginx site uses `/etc/nginx/ssl/router.budgezen.com.{crt,key}`  
- Full (strict) SSL mode  
- Public health 200  

### Data migration

See `docs/evidence/phase-09/01-provider-data-migration.md`.

| Wave | Content | Result |
|------|---------|--------|
| 1 | non-mimo `providerConnections` | ~13.7k on dest |
| 2 | nodes + proxies + combos + kv | 3 / 65 / 8 / 104 scopes |

### Documentation finalize

- `docs/RELEASE.md` — final release status SSOT for ops  
- Evidence phase-09 + update phase-08 public HTTPS artifact  
- Runbooks go-live checklist updated  
- Execution matrix marked F0–F9 complete  
- CHANGELOG + VERSION bump to `0.5.35-mw.6`  

## Exit criteria

- [x] Health local + public GREEN  
- [x] Workers=4, Redis 6381, WAL  
- [x] Non-mimo providers + custom nodes + proxy pools present  
- [x] Final docs committed and tagged  
- [x] No foreign stack damage  

## Follow-up (ops, not blocking release docs)

- 24–48h watch  
- Optional low-QPS real provider smoke  
- Create API keys on MW for clients  
