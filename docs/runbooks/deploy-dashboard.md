# Runbook — Deploy Phase 1 /mw/ Dashboard

## Status

**Fail-closed.** Remote deployment cannot proceed until an operator supplies
all `DASHBOARD_*` variables in [Prerequisites](#prerequisites) and confirms the
release layout, server identity, and access method. This document is a
procedure only. It does not deploy, modify, or verify any live resource and
makes no claim about current production state.

## Architecture (approved ADR)

```
User browser → https://example.com/mw/
  → Nginx location /mw/api/  (proxy, before static)   → backend worker
  → Nginx location /mw/      (static SPA fallback)    → [DASHBOARD_SERVE_DIR]/dist
  → Nginx location /         (legacy gateway proxy)   → backend worker
```

| Property | Value |
| --- | --- |
| SPA framework | React + Vite (build output in `[DASHBOARD_SERVE_DIR]/dist`) |
| Base path | `/mw/` |
| Auth | Existing `auth_token` JWT cookie (issued by the main dashboard) |
| API root | `/mw/api/v1/*` (existing Next.js App Router routes, GET-only) |
| SSE stream | `/mw/api/v1/stream` (separate from any legacy stream) |
| Live state | Backend worker process (Redis-backed global state) |
| Legacy stream | Untouched (this runbook must not modify it) |
| Rollback scope | Three layers: static SPA, nginx config, backend release |

This runbook does not add new auth, does not add new backend routes, and does
not require a separate `dashboard-express.js` or custom-server wiring. The
`/mw/api/v1/*` routes are existing Next.js App Router routes already shipped
in the release tree.

## Prerequisites (operator must supply before start)

### Required variables (placeholders only)

| Variable | Example placeholder | Notes |
| --- | --- | --- |
| `DASHBOARD_DEPLOY_TARGET` | `user@[REDACTED-HOST]` | Operator-supplied SSH target |
| `DASHBOARD_SSH_KEY` | `[REDACTED-SSH-PATH]` | Operator SSH key path |
| `DASHBOARD_RELEASE_ID` | `[DASHBOARD_RELEASE_ID]` | Release identifier in source tree |
| `DASHBOARD_SOURCE_DIR` | `[DASHBOARD_SOURCE_DIR]` | Path to dashboard source within release |
| `DASHBOARD_SERVE_DIR` | `[DASHBOARD_SERVE_DIR]` | Path the nginx `location /mw/` block serves from |
| `DASHBOARD_NGINX_SITE` | `[DASHBOARD_NGINX_SITE]` | Path to the active nginx site config |
| `DASHBOARD_BACKEND_HEALTH` | `[DASHBOARD_BACKEND_HEALTH]` | Internal URL to verify backend is up |

Do not paste real values into this runbook. Replace placeholders locally for
each session.

### Required confirmations

- [ ] All `DASHBOARD_*` variables above are supplied and verified for this session
- [ ] SSH access to `DASHBOARD_DEPLOY_TARGET` works as the deploy user
- [ ] Release tree contains `dashboard/package.json` matching `DASHBOARD_RELEASE_ID`
- [ ] `/mw/api/v1/*` routes exist in the release tree (existing Next.js routes)
- [ ] nginx example config reviewed: `docs/deploy/nginx-edge.example.conf`
- [ ] `auth_token` JWT verification is enabled in the existing backend
- [ ] A recent backup of `DASHBOARD_NGINX_SITE` exists outside the release tree
- [ ] Rollback plan in [Rollback](#rollback) is understood

## Operator acknowledgement

Every remote command in this runbook is preceded by an explicit
acknowledgement block:

```text
> OPERATOR ACK: I confirm the DASHBOARD_* variables for this session,
> the release layout, and my access to DASHBOARD_DEPLOY_TARGET.
> Proceed only after the prerequisites above are checked.
```

Do not paste real variable values into the runbook. Substitute placeholders
locally in your shell or a session-scoped scratch file, then run commands
from there. Never commit real hosts, keys, or paths to this repository.

## Preflight

### 1. Verify release tree

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  ls -la [DASHBOARD_SOURCE_DIR]/
  cat [DASHBOARD_SOURCE_DIR]/package.json | grep version
  ls [DASHBOARD_SOURCE_DIR]/src/ [DASHBOARD_SOURCE_DIR]/vite.config.js
'
```

Expect: `version` matches `DASHBOARD_RELEASE_ID`; `src/` and `vite.config.js`
present.

### 2. Snapshot current nginx config (rollback baseline)

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  cp [DASHBOARD_NGINX_SITE] [DASHBOARD_NGINX_SITE].bak.$(date -u +%Y%m%dT%H%M%SZ)
  sha256sum [DASHBOARD_NGINX_SITE] [DASHBOARD_NGINX_SITE].bak.*
  nginx -t
'
```

Record both checksums in evidence. If `nginx -t` fails, stop and resolve
before any further change.

### 3. Verify `/mw/` is not already served

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  grep -nE "location [^[:space:]]*/mw/" [DASHBOARD_NGINX_SITE] || echo "NO_MW_BLOCK"
  ls -la [DASHBOARD_SERVE_DIR] 2>/dev/null || echo "NO_SERVE_DIR"
'
```

If either returns a match, this is an update or a collision. Stop and
confirm intent before proceeding.

### 4. Verify existing `/mw/api/v1/*` backend routes respond

```bash
curl -s -o /dev/null -w '%{http_code}\n' [DASHBOARD_BACKEND_HEALTH]/mw/api/v1/health
```

Expect: `200` (unauthenticated health) or `401` (auth required). A `404`
means the release tree does not yet ship the `/mw/api/v1/*` routes; stop
and roll the backend forward first.

## Build (on target)

### 5. Install dashboard dependencies

> OPERATOR ACK: building on `[DASHBOARD_DEPLOY_TARGET]` from
> `[DASHBOARD_SOURCE_DIR]`. Proceed.

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  cd [DASHBOARD_SOURCE_DIR]
  npm ci --production=false --no-fund --no-audit
'
```

### 6. Build SPA

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  cd [DASHBOARD_SOURCE_DIR]
  npm run build
'
```

### 7. Verify build artifact integrity

> OPERATOR ACK: recording build checksums to evidence before any deploy
> step. Proceed.

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  ls -la [DASHBOARD_SOURCE_DIR]/dist/
  find [DASHBOARD_SOURCE_DIR]/dist -type f | sort
  sha256sum [DASHBOARD_SOURCE_DIR]/dist/index.html
  sha256sum [DASHBOARD_SOURCE_DIR]/dist/assets/*
'
```

Pass criteria: `index.html` exists; `assets/` contains hashed `.js` and
`.css` files; no `.map` files (sourcemaps disabled in build config).

### 8. Cleanup node_modules

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  rm -rf [DASHBOARD_SOURCE_DIR]/node_modules
'
```

## Nginx config validation

### 9. Review the approved `/mw/` block layout (template only)

The example config (`docs/deploy/nginx-edge.example.conf`) is a template
only. It is not the active site config. The three blocks that must be
present, in this order, in the active `DASHBOARD_NGINX_SITE`:

| Order | Block | Purpose |
| --- | --- | --- |
| 1 | `location /mw/api/` | Proxy to backend, SSE-ready, no cache |
| 2 | `location = /mw/index.html` | Static, no-store cache |
| 3 | `location ~* ^/mw/.*\.(css\|js\|...)$` | Static, immutable cache, 1y |
| 4 | `location /mw/` | SPA fallback (`try_files ... /mw/index.html`) |

Insertion point: immediately before the existing `location /` proxy block.

### 10. Stage the `/mw/` block (template content)

> The block below is a **template** adapted from the example config. It
> is not executable as written; the operator must substitute
> `[DASHBOARD_SERVE_DIR]` and any backend upstream name, and insert it
> into a copy of `[DASHBOARD_NGINX_SITE]` for `nginx -t` validation.

```nginx
# Begin /mw/ dashboard block (template — do not apply as-is)
# API proxy must win before the SPA fallback
location /mw/api/ {
    proxy_pass http://[BACKEND_UPSTREAM];
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    add_header Cache-Control "no-store" always;
    add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "DENY" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
}

location = /mw/index.html {
    root [DASHBOARD_SERVE_DIR]/dist;
    add_header Cache-Control "no-store" always;
    # (security headers — same as /mw/api/)
}

location ~* ^/mw/.*\.(css|js|mjs|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$ {
    root [DASHBOARD_SERVE_DIR]/dist;
    expires 1y;
    add_header Cache-Control "public, immutable";
    # (security headers — same as /mw/api/)
}

location /mw/ {
    root [DASHBOARD_SERVE_DIR]/dist;
    try_files $uri $uri/ /mw/index.html;
    # (security headers — same as /mw/api/)
}
# End /mw/ dashboard block
```

The template is illustrative. Refer to `docs/deploy/nginx-edge.example.conf`
for the canonical full content (header sets on every block, exact regex).

### 11. Validate nginx config syntax

> OPERATOR ACK: validating the staged nginx config before reload. Proceed.

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  # Operator: copy [DASHBOARD_NGINX_SITE] to a test path, insert the
  # staged /mw/ block before the existing location /, then:
  nginx -t -c [TEST_NGINX_PATH]
'
```

If `nginx -t` fails, fix syntax errors before proceeding. Do not reload
until validation passes.

## Release activation

### 12. Symlink build artifact into serve path

> OPERATOR ACK: linking the new build to `[DASHBOARD_SERVE_DIR]/dist`.
> Proceed.

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  rm -f [DASHBOARD_SERVE_DIR]/dist
  ln -sfn [DASHBOARD_SOURCE_DIR]/dist [DASHBOARD_SERVE_DIR]/dist
  ls -la [DASHBOARD_SERVE_DIR]
'
```

### 13. Reload nginx

> OPERATOR ACK: reloading nginx with the new `/mw/` block. Proceed.

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  nginx -t
  systemctl reload nginx
'
```

Use `reload`, not `restart`, to preserve open connections (including any
live streams).

## Smoke tests

All smoke tests are read-only `curl` calls. Do not mutate state.

### 14. Static SPA loads

> OPERATOR ACK: read-only smoke test against `example.com`. Proceed.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/mw/index.html
```

Expect: `200`.

### 15. Static assets respond with immutable cache

> OPERATOR ACK: read-only smoke test. Proceed.

```bash
ASSET=$(curl -sS https://example.com/mw/index.html | grep -oE '/mw/assets/[^"'\'']+' | head -1)
curl -sSI "https://example.com${ASSET}" | grep -i 'cache-control'
```

Expect: `Cache-Control: public, immutable` (or `max-age` ≥ 31536000).

### 16. API proxy wins over SPA fallback (API-before-SPA invariant)

> OPERATOR ACK: read-only smoke test. Proceed.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/mw/api/v1/health
curl -sS https://example.com/mw/api/v1/health
```

Expect: `200` or `401`. Body must be JSON, not HTML. A `200` with an HTML
body means the SPA fallback swallowed the API route — do not declare
success.

### 17. Unauthenticated API returns 401

> OPERATOR ACK: read-only smoke test. Proceed.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/mw/api/v1/providers
```

Expect: `401` JSON, not HTML.

### 18. Legacy paths untouched

> OPERATOR ACK: read-only smoke test. Proceed.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/
```

Expect: same behavior as before this deploy (typically `200` for health,
`307` for root redirect).

### 19. SPA routes resolve (client-side routing)

> OPERATOR ACK: read-only smoke test. Proceed.

```bash
for path in /mw/ /mw/overview /mw/providers; do
  printf '%s ' "$path"
  curl -sS -o /dev/null -w '%{http_code}\n' "https://example.com${path}"
done
```

Expect: all `200` (SPA fallback returns `index.html`).

## Evidence collection

Record the following to `docs/evidence/dashboard/phase-XX-deploy/`:

| Evidence | Source | Pass criteria |
| --- | --- | --- |
| Build checksums | Step 7 output | All `dist/` assets listed, no `.map` |
| nginx config backup checksum | Step 2 output | Matches pre-deploy |
| nginx config test result | Steps 2, 11, 13 output | `syntax is ok`, `test is successful` |
| nginx config active checksum | Step 13 post-reload output | Differs from backup (new block active) |
| Symlink target | Step 12 output | `readlink -f` points to release dist |
| /mw/index.html status | Step 14 | `200` |
| /mw/assets cache header | Step 15 | `public, immutable` or `max-age` ≥ 1y |
| /mw/api/v1/health (no cookie) | Step 16 | `200` or `401`, JSON body |
| /mw/api/v1/providers (no cookie) | Step 17 | `401`, JSON body |
| Legacy /api/health unchanged | Step 18 | Matches pre-deploy |
| SPA fallback HTML | Step 19 | `200` for `/mw/`, `/mw/overview`, `/mw/providers` |

Redact any hostnames, IPs, SSH key paths, or credentials before commit.

## Rollback

### Rollback decision tree

```
Is /mw/api/v1/* broken (non-JSON, 5xx)?
  ├─ YES → Is the existing backend /mw/api/v1/* healthy on a non-/mw/ path?
  │   ├─ YES → Rollback nginx only (remove /mw/ blocks, reload)
  │   └─ NO  → Roll back all three layers (static + nginx + backend release)
  └─ NO  → Is the SPA blank or failing to load?
      ├─ YES → Rollback static SPA only (relink previous dist)
      └─ NO  → Suspect cache poisoning?
          ├─ YES → Reload nginx, adjust cache headers
          └─ NO  → Investigate before any rollback
```

### Three-layer rollback

Each layer can be rolled back independently. Roll back only what is broken.

#### Layer 1: Static SPA

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  rm -f [DASHBOARD_SERVE_DIR]/dist
  ln -sfn [DASHBOARD_PREVIOUS_SOURCE_DIR]/dist [DASHBOARD_SERVE_DIR]/dist
'
```

No nginx reload is required for static-file changes.

#### Layer 2: Nginx config

```bash
ssh -i [DASHBOARD_SSH_KEY] [DASHBOARD_DEPLOY_TARGET] '
  cp [DASHBOARD_NGINX_SITE].bak.[TIMESTAMP] [DASHBOARD_NGINX_SITE]
  nginx -t && systemctl reload nginx
'
```

#### Layer 3: Backend release

Follow the existing release rollback procedure (no changes from this
runbook apply to the backend release lifecycle).

### Paired rollback (complete revert)

To revert the dashboard entirely, perform layers 1, 2, and 3 in that order.
After each layer, run the smoke tests in [Smoke tests](#smoke-tests) and
confirm legacy paths still return their pre-deploy status.

### Rollback validation

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/mw/index.html
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/api/health
```

After rollback, confirm the legacy gateway is healthy and no `/mw/` paths
are accidentally proxied to the backend.

## Verification summary

After deploy, record the following in `docs/evidence/dashboard/phase-XX-deploy/`:

| Check | Result | Evidence file |
| --- | --- | --- |
| nginx -t | PASS/FAIL | `01-nginx-test.txt` |
| /mw/index.html 200 | PASS/FAIL | `02-index-http.txt` |
| /mw/assets cache header | PASS/FAIL | `03-asset-cache.txt` |
| /mw/api/v1/health 200/401 (JSON) | PASS/FAIL | `04-api-health.txt` |
| /mw/api/v1/providers 401 (JSON) | PASS/FAIL | `05-api-auth.txt` |
| Legacy /api/health unchanged | PASS/FAIL | `06-legacy-health.txt` |
| SPA fallback HTML | PASS/FAIL | `07-spa-fallback.txt` |
| dist symlink correct | PASS/FAIL | `08-symlink.txt` |

## Limitations

- The repository deploy target, server identity, and release layout are
  unverified. This runbook is operator-driven and fails closed.
- No CI/CD pipeline exists for the dashboard build. Build must run on the
  target.
- The nginx `/mw/` block template is illustrative; the canonical full
  content is in `docs/deploy/nginx-edge.example.conf`.
- The nginx config merge (`/mw/` block insertion) is a manual operator
  step. No sed/awk automation is provided.
- No dashboard-specific automated rollback script exists. The three-layer
  rollback here is operator-executed.
- Cache invalidation for hot-fixed dist assets requires a filename change
  or cache-bust query parameter.
- This runbook does not configure edge caching for `/mw/`. If a proxy
  caches the dashboard, additional cache rules may be needed.
- The `bun run lint:md` and `bun run lint:md:fix` scripts referenced by
  the OCS markdown autofix skill are not defined in the root
  `package.json`. Formatting was verified manually.
- No markdown language server is configured in this environment
  (`lsp_diagnostics` reports no server for `.md`). Markdown structure was
  self-audited.
