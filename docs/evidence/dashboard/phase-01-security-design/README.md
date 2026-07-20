# Phase 01 Security Design

## Intent and criteria

Define the Phase 1 security boundary before code: existing JWT-only dashboard
authentication, GET-only routes, pre-serialization allowlists/redaction,
bounded data access, strict read-only SQLite, and a same-origin SSE contract.

## Reviewed/changed files

- Reviewed:
  - `docs/adr/ADR-MW-READONLY-DASHBOARD.md`
  - `src/lib/auth/dashboardSession.js`
  - `src/dashboardGuard.js`
  - `src/proxy.js`
  - `src/lib/auth/loginLimiter.js`
  - `custom-server.js`
  - `open-sse/services/liveUsageState.js`
  - `open-sse/services/redisClient.js`
  - `src/lib/db/driver.js`
  - `src/lib/db/schema.js`
  - `src/app/api/usage/stream/route.js`
- Changed: this sanitized evidence record only.

## Commands

```text
read-only auth / CSRF / Redis / SQLite / SSE review
Context7: Vite, express-session, official session/SSE guidance
Oracle Phase 1 security architecture review
bun run lint:md:fix -- <docs>  # script missing in package.json
bun run lint:md -- <docs>      # script missing in package.json
```

## Sanitized output

```text
Approved Phase 1 auth: reuse existing auth_token verification only
No new login, logout, password, cookie, session store, or secret source
Every new dashboard endpoint: GET only and fail closed if JWT invalid/missing
No state-changing route: CSRF token path is deferred with mutation features
Legacy /api/usage/stream: unchanged and not used by new dashboard
New SSE: same-origin, authenticated, bounded/redacted, heartbeat + cleanup
Redis: no KEYS, no arbitrary browsing, no writes, no unbounded SMEMBERS
SQLite: native strict read-only connection; no migration/write/checkpoint/backup
Workers: unavailable until a shared fresh heartbeat exists
CORS: no permissive credentialed CORS; dashboard transport is same-origin
Errors/logging: generic bounded errors; never serialize secrets/raw payloads
```

## Test/build/health

- Tests: `NOT RUN` (security architecture gate only)
- Build: `NOT RUN`
- Health: `NOT RUN` (no production access)

## Risk/mitigation

- Risk: Existing JWT fallback can depend on shared secret/file visibility across
  workers.
- Mitigation: Route tests must prove valid/invalid JWT behavior; deployment
  evidence must validate shared secret configuration without revealing values.
- Risk: Existing login limiter is worker-local.
- Mitigation: Phase 1 exposes no login endpoint; distributed limiter deferred.
- Risk: Stored live/repository records include sensitive operational fields.
- Mitigation: DTO allowlist and hostile-fixture tests precede every response.
- Risk: SSE can retain resources or stale authorization.
- Mitigation: bounded heartbeat, disconnect cleanup, and auth/queue tests.

## Rollback implication

No authentication state is added or migrated. A future rollback restores a
paired `[REDACTED-RELEASE-POINTER]`; it does not alter Redis, SQLite, or JWT
state.

## Pass/fail status

`PASS` for Phase 1 security design. Runtime enforcement tests are pending.

## Commit links

`none` (no commit authorized yet)

## Required enforcement tests before implementation completion

1. Missing, malformed, expired, and valid `auth_token` cases fail/pass as
   expected for every new route.
2. REST, SSE, generic errors, and UI fixtures never contain credential-shaped
   or raw provider/request fields.
3. Redis readers reject prohibited commands and enforce key/result/time bounds.
4. SQLite reader cannot run migrations, writes, checkpoint, or backup actions.
5. SSE emits bounded payloads, sends heartbeat, and cleans listeners/timers on
   disconnect/error.
6. Legacy `/api/usage/stream` compatibility remains unchanged.
