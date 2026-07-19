# Phase-06 Evidence — F6 Hot-path Performance

**Version:** `0.5.35-mw.4`  
**Release HEAD:** `14767d6b`  
**VPS:** `/opt/9router-mw/releases/0.5.35-mw.4`  
**Goal:** undici keep-alive Agent, native SQLite only in prod, log defaults, ipv4first.

## Exit criteria — MET

| Check | Result | Evidence |
|-------|--------|----------|
| undici Agent + setGlobalDispatcher | PASS_UNDICI 20/20 | `02-undici-agent.txt`, health |
| Direct fetch dispatcher | OK | `proxyFetch.js` |
| ban sql.js prod | PASS_NATIVE_SQLITE better-sqlite3 | `02-native-sqlite.txt` |
| WAL | PASS_WAL + `-wal` file | `02-wal-pragma.txt`, `15-sqlite-files.txt` |
| LOG_LEVEL / request logs / ipv4 | set on VPS | `01-env-f6.txt` |
| 4 workers | PASS_FOUR | `08-processes.txt` |
| Redis | PASS_REDIS 20/20 | `10-health-analysis.txt` |
| claim 5/5 | PASS | `11-claim-test.txt` |
| k6 smoke | 9487 req, 0% fail, ~631 rps | `14-k6-smoke.txt` |
| Foreign redis | OK | `13-foreign-ok.txt` |

## Health sample (live)

```json
{"ok":true,"hotpath":{"undici":{"enabled":true,"connections":32,"pipelining":1},"sqlite":{"driver":"better-sqlite3","journalMode":"wal"}}}
```

## Code review

- [x] undici Agent global
- [x] sql.js banned in production multi-worker
- [x] WAL pragma central (schema)
- [x] Log defaults + ipv4first
- [x] No regression vs F5 smoke
