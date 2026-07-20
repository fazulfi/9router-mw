# Phase 02 Implementation Plan

## Intent and criteria

Lock a TDD-first Phase 1 execution plan that matches the approved ADR and does
not authorize commit, push, deploy, restart, or production configuration.

## Reviewed/changed files

- Reviewed:
  - `docs/adr/ADR-MW-READONLY-DASHBOARD.md`
  - `docs/superpowers/plans/2026-07-20-mw-readonly-dashboard.md`
  - `docs/plans/9router-mw-dashboard-plan.md` (historical reference only)
  - `package.json`
  - `docs/deploy/nginx-edge.example.conf`
- Changed:
  - `docs/adr/ADR-MW-READONLY-DASHBOARD.md`
  - `docs/superpowers/plans/2026-07-20-mw-readonly-dashboard.md`
  - `docs/evidence/dashboard/**` hierarchy and phase templates

## Commands

```text
read-only plan/ADR review
Oracle security validation of Phase 1 boundary
Plan agent Phase 1 workstream decomposition
bun run lint:md:fix -- <docs>  # script missing in package.json
bun run lint:md -- <docs>      # script missing in package.json
```

## Sanitized output

```text
Plan path: docs/superpowers/plans/2026-07-20-mw-readonly-dashboard.md
ADR path: docs/adr/ADR-MW-READONLY-DASHBOARD.md
Execution order:
  1) DTO/contract tests
  2) JWT-only route guard tests
  3) new GET /mw/api/v1/stream SSE tests
  4) bounded Redis projection tests
  5) strict SQLite reader tests
  6) workers unavailable projection tests
  7) Vite SPA shell + a11y/state tests
  8) nginx route-order + release pointer tests
  9) audits + evidence updates
Non-overlapping owners:
  docs/evidence, read model, API routes, SPA, nginx/release, audits
Hard stops:
  no Express/custom-server mount
  no legacy stream mutation/consumption
  no KEYS / unbounded SMEMBERS / raw Redis
  no SQLite migration/write path
  no login/password/session mutation
  no deploy/production claim without explicit checkpoint
Tooling gaps recorded:
  root package has no lint:md / lint:md:fix scripts
  root package has no Vite/React SPA dependencies yet
  Markdown LSP not configured
```

## Test/build/health

- Tests: `NOT RUN` (plan gate only; red tests not yet authored)
- Build: `NOT RUN`
- Health: `NOT RUN`

## Risk/mitigation

- Risk: Plan scope expands into Phase 2 mutation/auth rewrite.
- Mitigation: ADR deferral list and per-task stop conditions.
- Risk: Test runner/tooling missing for SPA or markdown gates.
- Mitigation: inspect actual runner before RED tests; record tooling debt
  honestly; do not invent pass results for missing scripts.
- Risk: Parallel owners collide on shared files.
- Mitigation: non-overlapping ownership and TDD ownership of contracts first.

## Rollback implication

Documentation-only at this gate. Implementation later must remain revertible by
paired release pointer; no partial static/API rollback.

## Pass/fail status

`PASS` for plan/ADR documentation gate. Implementation and red tests pending.

## Commit links

`none` (no commit authorized yet)

## Next authorized work

1. Confirm actual unit-test runner command and existing route-test patterns.
2. Start TDD for contracts/DTO and JWT-protected GET routes.
3. Keep SPA, nginx example, and audit workstreams non-overlapping.
4. Stop before any commit/push/deploy and request an explicit checkpoint.
