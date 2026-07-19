# F6 Research — Hot-path Performance

**Date:** 2026-07-19  
**Version target:** `0.5.35-mw.4`  
**SSOT:** plan §3.4–3.5 + §Fase 6 (lines 443–454)

---

## Plan F6 (locked)

1. undici `Agent` global di `proxyFetch` / base executor  
2. SQLite WAL pragma central (already in `schema.js` PRAGMA_SQL)  
3. Fail hard if better-sqlite3 missing in prod (`NODE_ENV=production` + `MW_REQUIRE_NATIVE_SQLITE=1`)  
4. Log defaults prod (`LOG_LEVEL=warn`, `ENABLE_REQUEST_LOGS=false`)  
5. `NODE_OPTIONS=--dns-result-order=ipv4first`  
6. Disable/gate expensive request logs  

**Exit:** no regression vs F3/F5 smoke; microbench optional

---

## Pre-F6 state (audited)

| Item | Status | Location |
|------|--------|----------|
| undici dep | present `^7.19.2` | package.json |
| Global undici Agent keep-alive | **MISSING** | proxyFetch only uses ProxyAgent for proxies; direct = raw fetch |
| WAL / busy_timeout / foreign_keys | **DONE** | `src/lib/db/schema.js` PRAGMA_SQL |
| better-sqlite3 adapter + WAL checkpoint | **DONE** | betterSqliteAdapter.js |
| sql.js fallback in prod multi-worker | **STILL ALLOWED** — must ban | driver.js trySqlJs |
| LOG_LEVEL=warn / ENABLE_REQUEST_LOGS=false | **ON VPS** | /etc/9router-mw/env |
| requestLogger gated | **DONE** | ENABLE_REQUEST_LOGS === 'true' |
| ipv4first NODE_OPTIONS | **ON VPS** | env.example + live env |
| systemd ExecStart ipv4 | via EnvironmentFile | 9router-mw.service |

---

## Implementation targets

### A. `open-sse/utils/proxyFetch.js`

- Create singleton `undici.Agent` with plan §3.5 defaults:
  - `connections: 32` (env `MW_UNDICI_CONNECTIONS`)
  - `pipelining: 1` (env `MW_UNDICI_PIPELINING`)
  - `keepAliveTimeout: 30_000`
  - `keepAliveMaxTimeout: 60_000`
- `setGlobalDispatcher(agent)` once at module load
- Direct `originalFetch` paths pass `dispatcher: getHotPathAgent()` when no proxy override
- Export `getHotPathAgentInfo()` for health

### B. `src/lib/db/driver.js`

- If `NODE_ENV=production` and `MW_REQUIRE_NATIVE_SQLITE` is not `0`:
  - Prefer better-sqlite3 only (Node)
  - **Do not** fall through to sql.js
  - Exit/throw with clear message if native unavailable

### C. Log defaults

- `custom-server.js` worker start: if prod and unset, default `LOG_LEVEL=warn`, `ENABLE_REQUEST_LOGS=false`
- env.example: document `MW_REQUIRE_NATIVE_SQLITE=1`

### D. Health (optional F6 field)

- `hotpath: { undici: true, sqliteDriver, journalMode }` best-effort

### E. Deploy

- Ensure VPS env has NODE_OPTIONS, LOG_LEVEL, MW_REQUIRE_NATIVE_SQLITE
- Confirm `data.sqlite-wal` appears after traffic (or pragma query)
- Smoke: 4 workers, redis, k6 no regression

---

## MUST NOT

- Touch foreign redis 6379/6380  
- Port Vans extras  
- Change worker count / cluster model  
- Enable body request logs in prod  

---

## Exit checklist

- [ ] undici Agent set as global dispatcher  
- [ ] Direct fetch uses keep-alive agent  
- [ ] Prod refuses sql.js when MW_REQUIRE_NATIVE_SQLITE≠0  
- [ ] WAL pragmas still applied (schema)  
- [ ] LOG_LEVEL warn + request logs off  
- [ ] ipv4first in env/systemd  
- [ ] Version 0.5.35-mw.4 deployed  
- [ ] Smoke no regression  
