# Phase 06 Nginx and Deployment Review

## Intent and criteria
Record future review evidence that `/mw/api/` routes before `/mw/` SPA fallback, that static/API caching semantics stay example-safe, and that restrictive CSP plus baseline security headers apply to the public `/mw/` SPA shell and protected `/mw/api/` API. No deployment execution is authorized here.

## Example-only note (2026-07-20)
`docs/deploy/nginx-edge.example.conf` documents API-before-SPA ordering for `/mw/api/` and `/mw/`, plus CSP and baseline security headers on both blocks. This is an example-only change: unit tests assert ordering, proxy/static directives, cache semantics, and security headers in the example file. No live nginx reload, deploy, or production host edit was executed.

## Reviewed/changed files
- Reviewed: `docs/deploy/nginx-edge.example.conf`, `tests/unit/mw-nginx-routing.test.js`, `dashboard/index.html` (Google Fonts sources)
- Changed: `docs/deploy/nginx-edge.example.conf`, `tests/unit/mw-nginx-routing.test.js`, this evidence README

## Commands
```text
read-only file review: completed
focused unit test (RED then GREEN): `vitest run unit/mw-nginx-routing.test.js --config ./vitest.config.js`
nginx reload/deploy/production access: not executed
```

## Sanitized output
```text
Example config retains `/mw/api/` before `/mw/` before `/`.
Static root uses the placeholder `/srv/example-dashboard`.
API fallback, cache, proxy buffering, and long-timeout safeguards remain covered by tests.
Security headers (always): Content-Security-Policy, X-Content-Type-Options, Referrer-Policy,
X-Frame-Options DENY, Permissions-Policy; CSP same-origin for script/style/connect with
documented Google Fonts hosts only; no wildcard sources.
RED (before conf update): Tests 1 failed | 4 passed (5) — missing CSP on /mw/api/
GREEN (after conf update): Test Files 1 passed (1); Tests 5 passed (5); local-only.
```

## Test/build/health
- Tests: `PASS` — `vitest run unit/mw-nginx-routing.test.js --config ./vitest.config.js` → 5/5 passed (local repository only; TDD RED then GREEN)
- Build: `NOT RUN`
- Health: `NOT RUN` — no deployment or production access authorized

## Risk/mitigation
- Risk: API responses are swallowed by SPA fallback, or edge responses lack baseline hardening headers.
- Mitigation: Route-order, cache, and CSP/security-header unit assertions on the example conf; no live edge change.

## Rollback implication
Restore the previous example root/placeholder values, prior header-less blocks, and prior evidence markers; do not execute deployment or restart actions.

## Pass/fail status
`PASS` (local example + unit verification only; no deploy)

## Commit links
`[REDACTED-COMMIT-LINK]` or `none`
