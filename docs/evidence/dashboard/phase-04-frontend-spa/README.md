# Phase 04 Frontend SPA

## Intent and criteria

Record evidence for the Vite `/mw/` shell, read-only states, GET-only API
calls, and use of the dedicated dashboard SSE endpoint rather than the legacy
usage stream. Architecture: public static SPA shell (`/mw/`) with JWT-protected
API (`/mw/api/v1/*`) and dedicated SSE stream endpoint.

## Reviewed/changed files

- Source: `dashboard/` Vite + React 19 + Tailwind CSS v4 project
- Entry: `main.jsx`, `App.jsx`, `index.css`
- Components (4): `AppShell.jsx`, `BottomTabs.jsx`, `PageChrome.jsx`, `StateBanner.jsx`
- Pages (6): `Overview.jsx`, `Providers.jsx`, `Redis.jsx`, `Settings.jsx`,
  `Usage.jsx`, `Workers.jsx`
- Hooks (2): `useDashboardSSE.js`, `useMwResource.js`
- Lib (3): `api.js`, `sanitize.js`, `state.js`
- Config: `vite.config.js` (base `/mw/`), `package.json` (build: `vite build`)
- Backend API routes: `src/app/mw/api/v1/` (health, overview, providers, redis,
  stream, usage, workers)
- Backend lib: `src/lib/mw/` (auth, http, deps, readModel/*)
- Changed: `none` (evidence recording only)

## Commands

```text
npx vitest run --config ./vitest.config.js unit/mw-spa-api.test.js unit/mw-spa-sanitize.test.js
npx vitest run --config ./vitest.config.js unit/mw-spa-api.test.js unit/mw-spa-sanitize.test.js unit/mw-stream.test.js unit/mw-auth.test.js unit/mw-api-routes.test.js unit/mw-sqlite-reader.test.js unit/mw-worker-reader.test.js unit/mw-redis-reader.test.js unit/mw-legacy-stream-immutable.test.js unit/mw-nginx-routing.test.js unit/dashboard-guard-mw.test.js unit/dashboard-guard.test.js
cd dashboard && npx vite build
```

## Sanitized output

```text
# SPA tests (30 tests)
  mw-spa-sanitize.test.js (12 tests)   12 passed
  mw-spa-api.test.js (18 tests)        18 passed
  Test Files  2 passed (2)
       Tests  30 passed (30)

# Focused dashboard suite (98 tests, 12 files)
  mw-spa-api.test.js             18 passed
  mw-spa-sanitize.test.js        12 passed
  dashboard-guard-mw.test.js      7 passed
  dashboard-guard.test.js        22 passed
  mw-auth.test.js                 4 passed
  mw-api-routes.test.js          11 passed
  mw-stream.test.js               4 passed
  mw-legacy-stream-immutable      1 passed
  mw-sqlite-reader.test.js        4 passed
  mw-redis-reader.test.js         4 passed
  mw-worker-reader.test.js        6 passed
  mw-nginx-routing.test.js        5 passed
  Test Files  12 passed (12)
       Tests  98 passed (98)

# Vite build
vite v7.3.6 building client environment for production...
  2093 modules transformed
  built in 9.06s
  dist/index.html                 0.81 kB
  dist/assets/index-BYtg37k4.css  14.72 kB
  dist/assets/index-CMeVVEoi.js  385.48 kB
```

## Test/build/health

- Tests: 30 SPA tests pass (18 api + 12 sanitize); focused dashboard suite:
  12 files / 98 tests pass
- Build: Vite build PASS (2093 modules, 10.09s, sourcemaps disabled)
- Health: No deployment; local-only verification. No live nginx validation in
  this phase.

## Risk/mitigation

- Risk: UI implies health or calls a mutable/legacy transport.
- Mitigation: Explicit unavailable states and endpoint contract tests enforce
  read-only GET semantics.
- Risk: No production nginx or TLS validation in this phase.
- Mitigation: Nginx config evidence recorded separately in Phase 06.

## Rollback implication

Restore the paired static server config pointer; do not roll back assets alone.

## Pass/fail status

`PASS` (local evidence only; no deployment)

## Commit links

`none` (evidence recording only, no commit)
