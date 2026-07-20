# Phase 1 Read-Only `/mw/` Dashboard Implementation Plan

## Goal

Create a Phase 1 read-only Vite dashboard at `/mw/` with authenticated same-origin bounded/redacted realtime SSE and GET-only Next APIs under `/mw/api/v1/*`. Preserve the legacy `/api/usage/stream` unchanged. This plan authorizes documentation and future implementation only; it makes no execution, deployment, production verification, or production-readiness claim.

## Architecture

- Vite SPA with base `/mw/`, static assets, and read-only UI states.
- Current workers and Next route handlers own all new `/mw/api/v1/*` APIs.
- Existing `auth_token` JWT verification is the only authentication source.
- New dashboard realtime transport is an authenticated same-origin bounded/redacted SSE GET endpoint under `/mw/api/v1/*`; it emits bounded heartbeats and cleans listeners/timers on disconnect and error.
- Existing `/api/usage/stream` remains unchanged and is not the dashboard realtime transport.
- Redis uses explicit bounded projections; no `KEYS`, unbounded `SMEMBERS`, arbitrary browsing, raw records, or writes.
- SQLite uses a native strict read-only reader with no migration, write, schema sync, checkpoint, or backup mutation.
- Worker status is `unavailable` until a fresh heartbeat is observed.
- Nginx routes API before SPA fallback.
- Static, server, and edge configuration use one paired release pointer for rollback.

## Tech Stack

- Vite SPA under `/mw/`
- Existing Next handlers and JWT helper
- Same-origin `EventSource`-compatible SSE endpoint
- Native strict read-only SQLite adapter
- Bounded Redis projection
- Repository test runner and existing build tooling
- Markdown evidence templates with sanitized placeholders

## Global Constraints

- New dashboard APIs are GET-only under `/mw/api/v1/*`.
- Do not modify `custom-server.js` to add an Express mount.
- Do not modify or consume the legacy `/api/usage/stream` for this dashboard.
- Do not add login, password, session, cookie, or secret sources.
- Do not expose credentials, API keys, token material, raw Redis records, raw database blobs, provider inventories, hostnames, IPs, or private paths.
- Do not use `KEYS`, unbounded `SMEMBERS`, arbitrary key input, Redis writes, SQLite writes, migrations, checkpoints, or schema changes.
- Do not modify runtime source, tests, package manifests, deployment scripts, nginx configuration, or the locked plan during this documentation task.
- Do not create deployment commands or make production assertions.
- No `TODO` or `TBD` appears in this plan.

## Agentic-worker execution instruction

For a later implementation session, execute each task in order with an agentic worker using test-first development: write the named failing tests before implementation, implement the smallest approved change, run targeted tests, record sanitized evidence, and stop on any ADR conflict. Do not claim completion until all applicable gates pass and evidence is reviewed.

## Verified code paths

| Path | Purpose | Boundary |
| --- | --- | --- |
| `custom-server.js` | Current worker entry | Review only; no Express mount. |
| `src/lib/auth/dashboardSession.js` | JWT verification | Reuse `auth_token`; no credential source. |
| `src/dashboardGuard.js` | Existing guard | Align fail-closed behavior. |
| `src/app/api/usage/stream/route.js` | Legacy SSE | Immutable and not consumed by dashboard. |
| `open-sse/services/liveUsageState.js` | Shared live state | Projection source only; no raw writer exposure. |
| `src/lib/db/driver.js` | Existing driver selection | Do not call migrating writer path. |
| `src/lib/db/schema.js` | Existing read model | No schema change. |
| `docs/deploy/nginx-edge.example.conf` | Edge reference | Verify API-before-fallback ordering only. |
| `docs/deploy/` | Rollback reference | Pointer contract only; do not execute or modify. |

## TDD-first task boundaries

### Task 1: Contract, DTO, and redaction tests

Write failing tests for endpoint paths, GET-only methods, allowlisted fields, redaction, record limits, byte limits, generic errors, and worker-unavailable representation.

Planned files:

- `src/app/mw/api/v1/_contract.js`
- `src/app/mw/api/v1/_dto.js`
- `src/app/mw/api/v1/__tests__/contract.test.js`
- `src/app/mw/api/v1/__tests__/dto.test.js`

Acceptance: unknown fields, oversized records, credentials, raw payloads, and non-GET methods are rejected.

### Task 2: JWT-only guard tests and implementation

Write failing tests for absent, malformed, expired, invalid, and valid `auth_token` cookies. Implement a shared fail-closed guard without login, logout, password comparison, or fallback credentials.

Planned files:

- `src/app/mw/api/v1/_auth.js`
- `src/app/mw/api/v1/__tests__/auth.test.js`

Acceptance: only valid existing JWT sessions pass.

### Task 3: Dedicated dashboard SSE tests and implementation

Write failing tests for authenticated same-origin access, bounded event DTOs, event-size limits, heartbeat emission, cleanup on cancellation, cleanup on stream error, and no mutation of the legacy SSE route. Implement the new dashboard SSE route under `/mw/api/v1/stream` as GET-only.

Planned files:

- `src/app/mw/api/v1/stream/route.js`
- `src/app/mw/api/v1/__tests__/stream.test.js`
- `src/app/mw/api/v1/__tests__/legacy-stream-immutable.test.js`

Acceptance: SSE is bounded/redacted, sends heartbeats, cleans resources, and leaves `src/app/api/usage/stream/route.js` unchanged.

### Task 4: Bounded Redis projection

Write failing command-spy tests proving explicit bounded reads only. Implement a projection that cannot accept arbitrary keys and never uses `KEYS`, unbounded `SMEMBERS`, or write commands.

Planned files:

- `src/app/mw/api/v1/redis/route.js`
- `src/app/mw/api/v1/__tests__/redis.test.js`

Acceptance: unavailable/error output is generic and all results are bounded/redacted.

### Task 5: Strict read-only SQLite reader

Write failing tests proving the reader does not invoke `getAdapter`, migration, schema sync, writes, checkpoints, or backup mutation. Implement native strict read-only access and bounded aggregate queries.

Planned files:

- `src/app/mw/api/v1/db/readOnlyReader.js`
- `src/app/mw/api/v1/providers/route.js`
- `src/app/mw/api/v1/usage/route.js`
- `src/app/mw/api/v1/__tests__/readOnlyReader.test.js`
- `src/app/mw/api/v1/__tests__/providers.test.js`
- `src/app/mw/api/v1/__tests__/usage.test.js`

Acceptance: only approved read projections serialize.

### Task 6: Heartbeat projection

Write failing tests for missing, stale, malformed, partial, and fresh heartbeats. Implement worker DTOs that remain unavailable until freshness criteria pass.

Planned files:

- `src/app/mw/api/v1/_heartbeat.js`
- `src/app/mw/api/v1/workers/route.js`
- `src/app/mw/api/v1/__tests__/heartbeat.test.js`
- `src/app/mw/api/v1/__tests__/workers.test.js`

Acceptance: process count, PID, startup log, and uptime cannot establish health.

### Task 7: Vite SPA shell

Write failing tests for `/mw/` asset base, GET-only API calls, new dashboard SSE consumption, immutable legacy SSE non-use, loading, unavailable, empty, and generic error states. Implement only read-only navigation and display.

Planned files:

- `dashboard/index.html`
- `dashboard/vite.config.js`
- `dashboard/src/main.jsx`
- `dashboard/src/App.jsx`
- `dashboard/src/lib/api.js`
- `dashboard/src/hooks/useDashboardSSE.js`
- `dashboard/src/__tests__/api.test.js`
- `dashboard/src/__tests__/App.test.jsx`

Acceptance: UI uses `/mw/` URLs and the new `/mw/api/v1/stream` endpoint only.

### Task 8: Nginx ordering and paired rollback pointer

Write failing tests for `/mw/api/` precedence over `/mw/` fallback and for pointer mismatch blocking promotion. Document atomic restoration without database or Redis mutation. Do not edit or execute deployment artifacts in this documentation task.

Planned files:

- `dashboard/tests/nginx-route-order.test.js`
- `dashboard/tests/release-pointer.test.js`
- `docs/evidence/dashboard/phase-06-nginx-deploy/README.md`
- `docs/evidence/dashboard/phase-08-finalization/README.md`

Acceptance: API errors cannot become SPA documents; partial rollback is rejected.

### Task 9: Verification and evidence review

Run applicable tests, build checks, required Markdown commands, and diagnostics. Record only sanitized results in the evidence directories. Production verification is not authorized by this plan.

Required Markdown commands:

```text
bun run lint:md:fix -- "<touched-file-1>" "<touched-file-2>"
bun run lint:md -- "<touched-file-1>" "<touched-file-2>"
```

Acceptance: report actual command exit status. Do not claim success if the scripts are unavailable. Record Markdown LSP absence as a limitation.

## Reconciliation and stop conditions

Stop if implementation requires changing or consuming `/api/usage/stream`, adding a credential source, mounting Express, exposing raw Redis, using prohibited Redis commands, opening SQLite through the migrating writer, changing schema, or asserting worker health without heartbeat. Resolve any conflict in the ADR first.

## Rollback model

Promotion and rollback use one paired static/server/config pointer represented only as `[REDACTED-RELEASE-POINTER]`. Restore the previous pointer atomically. Do not restore only assets, mutate Redis, migrate or restore the database, or change authentication state.

## Definition of done for this plan

- ADR, evidence hierarchy, and this plan are internally consistent.
- All implementation tasks are TDD-first with concrete files and tests.
- Dedicated dashboard SSE is authenticated, same-origin, bounded, redacted, heartbeat-enabled, and cleanup-tested.
- Legacy `/api/usage/stream` remains unchanged and is not the dashboard realtime transport.
- Security gates, explicit deferrals, rejected alternatives, reconciliation, and rollback implications are recorded.
- No implementation, deployment, production verification, or production readiness is claimed.
