# Phase 1 Dashboard Evidence

Sanitized evidence hierarchy for the Phase 1 read-only `/mw/` dashboard. These templates record planned or future approved evidence only; they do not claim implementation, deployment, production verification, or production readiness.

## Required evidence rules

- Use `[REDACTED]` or generic placeholders only.
- Do not include credentials, operational identifiers, hostnames, IPs, private paths, provider inventories, raw Redis records, or raw database values.
- Record commands and actual exit statuses. Do not fabricate proof.
- Every phase README includes intent/criteria, reviewed/changed files, commands, sanitized output, test/build/health, risk/mitigation, rollback implication, pass/fail status, and commit links.

## Phase index

| Phase | Directory | Focus |
| --- | --- | --- |
| 00 | `phase-00-discovery` | Discovery and reconciliation |
| 01 | `phase-01-security-design` | Security design |
| 02 | `phase-02-implementation-plan` | Implementation plan |
| 03 | `phase-03-backend-api` | Backend API |
| 04 | `phase-04-frontend-spa` | Frontend SPA |
| 05 | `phase-05-tests-audit` | Tests and audit |
| 06 | `phase-06-nginx-deploy` | Nginx and deployment review |
| 07 | `phase-07-production-verification` | Future approved verification evidence only |
| 08 | `phase-08-finalization` | Finalization and rollback review |

## Source documents

- ADR: [`../../adr/ADR-MW-READONLY-DASHBOARD.md`](../../adr/ADR-MW-READONLY-DASHBOARD.md)
- Plan: [`../../superpowers/plans/2026-07-20-mw-readonly-dashboard.md`](../../superpowers/plans/2026-07-20-mw-readonly-dashboard.md)
