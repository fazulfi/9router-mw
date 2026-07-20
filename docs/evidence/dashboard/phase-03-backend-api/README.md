# Phase 03 Backend API

## Intent and criteria

Record evidence for authenticated GET-only Next APIs under `/mw/api/v1/*`,
bounded/redacted dashboard SSE with heartbeat and cleanup, bounded Redis
projections, strict read-only SQLite access, and honest worker unavailable
state. Legacy `/api/usage/stream` must remain immutable.

## Reviewed/changed files

- Reviewed: `src/lib/auth/dashboardSession.js`, `src/dashboardGuard.js`,
  `open-sse/services/liveUsageState.js` (pattern only)
- Changed:
  - `src/lib/mw/auth.js`
  - `src/lib/mw/http.js`
  - `src/lib/mw/deps.js`
  - `src/lib/mw/readModel/redisReader.js`
  - `src/lib/mw/readModel/sqliteReader.js`
  - `src/lib/mw/readModel/workerReader.js`
  - `src/lib/mw/readModel/openReadOnlySqlite.js`
  - `src/app/mw/api/v1/{health,overview,providers,redis,workers,usage,stream}/route.js`
  - `src/dashboardGuard.js` (JWT-only `/mw/api` block)
  - `tests/unit/mw-*.test.js`, `tests/unit/dashboard-guard-mw.test.js`

## Commands

```text
cd tests
npx vitest run --config .\vitest.config.js unit\mw-stream.test.js unit\dashboard-guard-mw.test.js unit\mw-legacy-stream-immutable.test.js unit\mw-auth.test.js unit\mw-api-routes.test.js unit\mw-redis-reader.test.js unit\mw-sqlite-reader.test.js unit\mw-worker-reader.test.js
npx vitest run --config .\vitest.config.js unit\dashboard-guard.test.js
```

## Sanitized output

```text
Test Files  8 passed (8)
Tests  41 passed (41)
Duration ~1s

dashboard-guard regression: 22 passed (22)
Legacy stream SHA256 lock: pass
```

## Test/build/health

- Tests: `PASS` (41 MW unit + 22 guard regression)
- Build: `NOT RUN` (Next production build deferred to later gate)
- Health: `NOT RUN` (no production access)

## Risk/mitigation

- Risk: Unbounded Redis, raw secrets in DTOs, SSE leak, requireLogin bypass.
- Mitigation: SCAN/LRANGE bounds, allowlist projection, JWT-only edge +
  route guards, SSE cancel clears heartbeat, legacy stream hash lock.

## Rollback implication

Restore the paired release pointer; remove `/mw/api` routes and SPA
together. Do not mutate Redis or SQLite on rollback.

## Pass/fail status

`PASS` (unit gates only; production verification not authorized)

## Commit links

`none` (no commit authorized yet)
