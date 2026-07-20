# Phase 00 Discovery

## Intent and criteria

Read-only reconciliation of the locked historical plan against the actual
repository topology before any runtime code change. Criteria: identify
listener ownership, auth boundary, live Redis/SQLite surfaces, nginx/release
anchors, and mark plan assumptions VERIFIED / CORRECTED / REJECTED.

## Reviewed/changed files

- Reviewed:
  - `custom-server.js`
  - `package.json`
  - `next.config.mjs`
  - `src/lib/auth/dashboardSession.js`
  - `src/dashboardGuard.js`
  - `src/proxy.js`
  - `src/lib/auth/loginLimiter.js`
  - `src/app/api/health/route.js`
  - `src/app/api/usage/stats/route.js`
  - `src/app/api/usage/history/route.js`
  - `src/app/api/usage/chart/route.js`
  - `src/app/api/usage/stream/route.js`
  - `open-sse/services/liveUsageState.js`
  - `open-sse/services/redisClient.js`
  - `src/lib/db/schema.js`
  - `src/lib/db/driver.js`
  - `src/lib/db/adapters/*`
  - `src/lib/db/repos/usageRepo.js`
  - `docs/deploy/nginx-edge.example.conf`
  - `docs/RELEASE.md`
  - `docs/plans/9router-mw-dashboard-plan.md`
- Changed: none (runtime). Documentation hierarchy later under
  `docs/evidence/dashboard/` and ADR/plan docs.

## Commands

```text
read-only explore of cluster/listener/auth/telemetry/db/deploy paths
Context7 queries for Vite base path and session cookie attributes
GIT_MASTER=1 git status / branch / recent log (sanitized)
bun run lint:md:fix -- <docs>  # script missing in package.json
bun run lint:md -- <docs>      # script missing in package.json
```

## Sanitized output

```text
Repo: clean working tree on master; origin tracks public fork remote
Cluster: custom-server.js primary forks workers; workers require generated
  standalone server.js and own the HTTP listener
Express /mw mount: NOT PRESENT
Auth: JWT cookie auth_token via dashboardSession + dashboardGuard
Login limiter: per-process memory (not distributed)
Legacy SSE: GET /api/usage/stream exists; must remain unchanged
Redis live keys: mw:live:active, mw:live:recent, mw:live:cnt:*, mw:live:lastErr
  recent payload may include credential-shaped fields (apiKey)
  active membership currently uses unbounded membership read pattern
SQLite: native/WAL production policy; driver path can migrate/write
  dashboard needs strict read-only reader (not yet present)
Frontend SPA /dashboard: NOT PRESENT
nginx /mw locations: NOT PRESENT in example edge config
Vite/React SPA tooling: NOT PRESENT in root package.json
markdown lint scripts lint:md / lint:md:fix: NOT PRESENT
Markdown LSP: not configured in this environment
```

## Test/build/health

- Tests: `NOT RUN` (discovery only)
- Build: `NOT RUN`
- Health: `NOT RUN` (no production access)

## Risk/mitigation

- Risk: Historical plan assumes Express mount in custom-server and password
  cookie auth.
- Mitigation: ADR Phase 1 replaces those with Next GET handlers + existing JWT.
- Risk: Raw live Redis fields can leak credentials if projected directly.
- Mitigation: Allowlisted DTO + redaction before serialization; no KEYS.
- Risk: Workers page has no per-worker heartbeat today.
- Mitigation: Honest `unavailable` status until heartbeat is proven.

## Rollback implication

No runtime change. Preserve existing release pointer
`[REDACTED-RELEASE-POINTER]`. Documentation-only rollback is delete/revert
ADR/evidence/plan files.

## Pass/fail status

`PASS` for discovery completeness. Implementation not started.

## Commit links

`none` (no commit authorized yet)

## Plan assumption reconciliation

| Assumption | Status | Note |
| --- | --- | --- |
| Express dashboard-express mounted in custom-server | REJECTED | Not present; primary has no request listener |
| Static password cookie auth | REJECTED | Existing JWT auth_token only |
| KEYS-based Redis browser | REJECTED | Must use bounded allowlisted reads |
| Unbounded live active membership for browser | CORRECTED | Need hard bounds / projection |
| Reuse legacy /api/usage/stream as dashboard transport | REJECTED | Immutable; new /mw/api/v1 stream required |
| SQL schema as in historical plan | CORRECTED | Use verified schema.js only |
| nginx /mw/api before SPA | VERIFIED as requirement | Not yet in example config |
| Independent Vite SPA under /mw/ | VERIFIED as requirement | Tooling not present yet |
| Exactly 4 workers; MITM off | VERIFIED invariant | Do not change cluster policy |
