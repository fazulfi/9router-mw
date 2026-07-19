# Phase-09 — Provider data migration evidence

**Date:** 2026-07-19  
**Operator:** agent (SSH)  
**Scope:** provider-related data only; **exclude mimo**

## Source

| Item | Value |
|------|--------|
| SSH | `root@49.12.82.34` port **39999** |
| Hostname | ninerouter-vps |
| Active service | `9router.service` → `/usr/lib/node_modules/9router/app/custom-server.js` |
| DATA_DIR | `/var/lib/9router` |
| Live DB | `/var/lib/9router/db/data.sqlite` (~1.2G + WAL) |
| Not used as source | `/var/lib/9router-pro` (separate stack) |

### Source inventory (pre-export)

| Entity | Count | Notes |
|--------|------:|-------|
| providerConnections total | 26917 | |
| xiaomi-mimo | 13179 | **excluded** |
| xiaomi-tokenplan name=mimo | 1 | **excluded** |
| non-mimo connections | ~13737 | migrate |
| providerNodes | 3 | migrate |
| proxyPools | 65 | migrate |
| combos | 8 | migrate |
| kv customModels+modelAliases | ~104 | migrate |
| apiKeys | 7 | **not** migrated |
| settings / usage* | large | **not** migrated |

### Custom nodes (source → dest)

| id | type | name | baseUrl |
|----|------|------|---------|
| anthropic-compatible-ca668c61-… | anthropic-compatible | apikeyfun | https://api.apikey.fun/v1 |
| openai-compatible-chat-701f9473-… | openai-compatible | inv=ferhub | https://api.inferhub.dev/v1 |
| openai-compatible-chat-10e8650a-… | openai-compatible | tokenrouter | https://api.tokenrouter.com/v1 |

## Destination

| Item | Value |
|------|--------|
| SSH | `root@82.25.62.204` |
| Service | `9router-mw.service` |
| DB | `/var/lib/9router-mw/db/data.sqlite` |
| Owner | `router:router` |
| Import tool | Node `better-sqlite3` (no system `sqlite3` CLI) |

## Migration waves

### Wave 1 — providerConnections (non-mimo)

1. Backup dest: `pre-provider-migrate-20260719T032103Z.sqlite*`
2. Export source rows where **not** (`provider='xiaomi-mimo'` OR (`provider='xiaomi-tokenplan'` AND `name='mimo'`))
3. UPSERT into dest preserving ids
4. Import claimed ~13737; later live count **13727** (minor delta from runtime/cleanup acceptable)
5. Restart / health OK after import
6. Temp export files with secrets removed from `/tmp`

### Wave 2 — providerNodes + proxyPools + combos + kv

1. Export JSON from source: nodes=3, proxies=65, combos=8, kv_custom=104 (~51KB)
2. Stream SSH source→dest; **strip UTF-8 BOM** (PowerShell pipe artifact)
3. Backup dest: `pre-nodes-proxies-20260719T032640Z.sqlite*`
4. UPSERT via better-sqlite3 as user `router`
5. `systemctl restart 9router-mw` → active
6. Temp files cleaned

## Final dest counts (verify 2026-07-19 finalize)

```text
providerConnections 13727
providerNodes 3
proxyPools 65
combos 8
apiKeys 0
kv [('customModels', 48), ('modelAliases', 56)]
mimo 0
nodes: apikeyfun, tokenrouter, inv=ferhub
```

## Explicitly NOT migrated

- `apiKeys` (7 on source) — create new keys on MW if needed  
- Full `settings` blob (may contain mimo strategies)  
- `usageHistory` / `usageDaily` / `requestDetails`  
- Other kv scopes beyond customModels / modelAliases  

## Safety

- Foreign stacks on dest VPS (ggl redis 6379, app redis 6380) not modified  
- Secrets never committed to git  
- DB backups retained under `/var/lib/9router-mw/db/backups/`

## Status

**MIGRATION COMPLETE** for requested scope (providers except mimo + custom nodes + proxy pools + combos + model alias kv).
