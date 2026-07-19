# Phase-06 Evidence — F6 Hot-path Performance

**Version:** `0.5.35-mw.4`  
**Goal:** undici keep-alive Agent, native SQLite only in prod, log defaults, ipv4first.

## Checklist

- [ ] Research MD: `docs/execution/F6-research-hotpath.md`
- [ ] undici Agent + setGlobalDispatcher in proxyFetch
- [ ] Direct fetch uses dispatcher Agent
- [ ] `MW_REQUIRE_NATIVE_SQLITE` bans sql.js in production
- [ ] WAL pragmas (schema PRAGMA_SQL) still applied
- [ ] Health exposes `hotpath.undici` + `hotpath.sqlite`
- [ ] LOG_LEVEL=warn, ENABLE_REQUEST_LOGS=false, NODE_OPTIONS ipv4first
- [ ] 4 workers, PASS_REDIS, k6 no regression
- [ ] Foreign redis 6379/6380 untouched

## Artifacts (after deploy)

| File | Content |
|------|---------|
| 02-version.txt | 0.5.35-mw.4 |
| 10-health-*.txt | hotpath.undici.enabled + sqlite WAL |
| 14-k6-smoke.txt | load smoke |
| 99-done.txt | complete |
