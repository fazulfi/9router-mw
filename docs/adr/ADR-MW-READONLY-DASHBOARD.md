# ADR-MW-READONLY-DASHBOARD

## Status

**Accepted for Phase 1 planning.** This ADR records the read-only dashboard boundary. It does not claim implementation, deployment, runtime validation, or production readiness.

## Context

Phase 1 defines an independent Vite SPA under `/mw/` with a read-only API boundary in the current Next workers. The historical dashboard proposal included a password source, writable settings, raw Redis inspection, an Express mount, and reuse of the legacy usage stream. Those choices are not approved for this phase.

Verified repository anchors:

| Concern | Verified path | Boundary |
| --- | --- | --- |
| Worker entry | `custom-server.js` | Current workers load the Next server; no Express dashboard mount is approved. |
| JWT cookie | `src/lib/auth/dashboardSession.js` | Reuse `auth_token` verification only. |
| Request guard | `src/dashboardGuard.js` | Align new handlers with existing protection. |
| Legacy SSE | `src/app/api/usage/stream/route.js` | Existing `GET` route remains unchanged. |
| Shared live state | `open-sse/services/liveUsageState.js` | Use bounded/redacted projections; do not expose writers or raw records. |
| SQLite driver | `src/lib/db/driver.js` | New reader must not use the migrating writer path. |
| Schema | `src/lib/db/schema.js` | Read existing schema only; no schema change. |
| Edge example | `docs/deploy/nginx-edge.example.conf` | API routing must precede SPA fallback. |
| Locked plan | `docs/plans/9router-mw-dashboard-plan.md` | Historical reference; this ADR resolves Phase 1 conflicts. |

Evidence remains sanitized: use `[REDACTED]` or generic placeholders for credentials, operational identifiers, hostnames, IPs, private paths, provider inventories, and payloads.

## Decision

1. Build a Vite SPA with base `/mw/` and static delivery.
2. Add only `GET` APIs under `/mw/api/v1/*` as Next handlers in current workers. No new server or Express mount.
3. Reuse the existing `auth_token` JWT verification path. Add no login, password, session, cookie, or secret source.
4. Leave the existing `/api/usage/stream` route unchanged. The new dashboard realtime transport is a separate authenticated, same-origin, bounded, redacted SSE endpoint under `/mw/api/v1/*`, with heartbeat and cleanup behavior. It is `GET` only.
5. Return allowlisted, redacted, bounded DTOs. Exclude credentials, API keys, token material, raw database blobs, raw Redis records, and internal error detail.
6. Redis access uses explicit allowlisted bounded reads. `KEYS`, unbounded `SMEMBERS`, arbitrary key browsing, and write commands are prohibited.
7. SQLite access uses a native strict read-only reader with no migration, schema synchronization, write, WAL checkpoint, or backup mutation.
8. Worker status is `unavailable` until a fresh heartbeat is observed. Process count, startup log, uptime, or inferred worker slot is not a heartbeat.
9. Nginx routes `/mw/api/` before `/mw/` SPA fallback; fallback never handles API requests.
10. Static assets, server artifact, and edge configuration move through one paired release pointer. Partial rollback is prohibited.
11. Contract, auth, redaction, bounds, SSE heartbeat/cleanup, read-only SQLite, route-order, and rollback-pointer tests are acceptance gates.

## Explicit deferrals

- Login, logout, password change, static password cookies, and any new session source.
- Express `dashboard-express.js` and a mount in `custom-server.js`.
- Any modification to `/api/usage/stream`, its payload, polling, or writers.
- Settings/provider/API-key mutation, restart controls, deployment controls, and shell actions.
- Raw Redis viewers, `KEYS`, unbounded `SMEMBERS`, and raw JSON exposure.
- SQLite migrations, schema edits, writes, checkpointing, and writer-adapter replacement.
- Worker health claims before heartbeat freshness exists.
- Deployment, restart, production verification, performance claims, or production readiness.

## Rejected alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| Old Express mount | **REJECTED** | Adds a second API boundary outside current Next handlers. |
| Static password cookie | **REJECTED** | Adds a credential and session source. |
| Raw Redis exposure | **REJECTED** | Risks identifiers, keys, payloads, and unbounded state. |
| `KEYS` approach | **REJECTED** | Unbounded and operationally unsafe. |
| Unbounded `SMEMBERS` | **REJECTED** | Unbounded response and membership disclosure. |
| Legacy `/api/usage/stream` as dashboard transport | **REJECTED for new dashboard** | It remains immutable; Phase 1 requires a dedicated authenticated bounded SSE endpoint. |

## Reconciliation status

| Area | Status | Reconciliation |
| --- | --- | --- |
| Vite `/mw/` SPA | Retained | Same independent static UI boundary. |
| Historical `/mw/api/*` Express routes | Replaced | Use `/mw/api/v1/*` Next handlers. |
| Password auth/settings | Deferred/rejected | Existing JWT only. |
| Legacy usage SSE | Retained unchanged | No mutation or dashboard consumption. |
| New dashboard realtime SSE | Added | Authenticated same-origin bounded/redacted GET stream with heartbeat and cleanup. |
| Redis inspection | Replaced | Explicit bounded redacted projections. |
| SQLite access | Replaced | Native strict read-only reader. |
| Worker status | Narrowed | Unavailable until fresh heartbeat. |
| Edge routing | Retained with gate | API before SPA fallback. |
| Release lifecycle | Added | Paired pointer enables atomic rollback. |

## Security gates

- Every dashboard endpoint is `GET` under `/mw/api/v1/*`.
- `auth_token` absence, expiry, malformation, and invalidity fail closed.
- DTO fields are allowlisted and redacted before serialization.
- Redis reads are bounded and contain no prohibited commands or writes.
- SQLite reader is native, strict read-only, and bypasses migration/checkpoint paths.
- SSE emits only bounded/redacted events, sends bounded heartbeats, and removes listeners/timers on disconnect or error.
- Errors are generic and bounded.
- Evidence contains no sensitive operational values.

## Rollback implications

Restore the previous paired static/server/config pointer atomically. Do not restore only assets, mutate Redis, migrate or restore the database, or change authentication state. Record only `[REDACTED-RELEASE-POINTER]` values.

## Acceptance statement

This ADR authorizes documentation and later implementation planning only. It makes no claim that code, tests, builds, health checks, deployment, or rollback have completed successfully.
