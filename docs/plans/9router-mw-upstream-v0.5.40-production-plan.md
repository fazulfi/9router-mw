# 9router-MW — Upstream v0.5.40 Selective Integration & Production Plan

> **Status:** REVIEW DRAFT — pending Momus APPROVAL before implementation
> **Plan path:** `.sisyphus/plans/9router-mw-upstream-v0.5.40-production.md`
> **Public copy:** `docs/plans/9router-mw-upstream-v0.5.40-production-plan.md`
> **Version candidate:** `0.5.40-mw.0`
> **Current HEAD:** `ae993b19` (reverted dashboard commits cleaned)
> **Upstream v0.5.40:** `79918c78`
> **Merge base:** `0513bf39`
> **Upstream commits since merge-base:** 13
> **Domain:** `example.com` | **Port plan:** production 20128/6381, staging 20129/6382
> **Language:** English with key Indonesian contextual notes

---

## 0. Executive Summary

**Goal:** Selectively integrate upstream `decolua/9router` v0.5.40 changes into `9router-mw`, preserving all MW production invariants (4 workers, Redis 6381 only, better-sqlite3 + WAL, MITM off, localhost bind, no secrets in git, no double-request). Stage the integration in an isolated environment before gated production rollout.

**Non-goals:**
- Porting upstream dashboard redesign or i18n/CLI features unrelated to MW invariants
- Creating an independent dashboard (confirmed canceled upstream too — all dashboard commits reverted at ae993b19)
- Changing worker count, Redis topology, SQLite driver policy, or deployment model

**Key risks:**
- Commit `6994cd1f` (cursor AgentService) touches `open-sse/handlers/chatCore.js` — a MW-wired file that must preserve semaphore/breaker/undici integration
- Commit `4f48ab8c` (better-sqlite3 bind fix) is critical for MW but changes an adapter used in production; must be verified in staging first
- The v0.5.40 release commit `79918c78` bumps version and CHANGELOG in ways that must merge cleanly with MW version scheme

---

## 1. Selective Integration: Patch Extraction Matrix

### 1.1 Blocker Commits — No-Commit/Patch Extraction

The three commits below require file-level accepted/rejected matrices. They will be extracted as patch files, split by accepted changes only, and applied as new MW commits.

#### Commit `4f48ab8c` — `fix: resolve better-sqlite3 parameter array binding crash`

| File | Verdict | Reason |
|------|---------|--------|
| `src/lib/db/adapters/betterSqliteAdapter.js` | **ACCEPT** | Fixes crash when queries have `?` parameters. Spreads positional args. Critical MW fix — matches bun:sqlite and node:sqlite adapter patterns. |

**Acceptance:** Apply the 3-line change (`.run(...params)`, `.get(...params)`, `.all(...params)`). Commit as MW commit `fix(mw): spread better-sqlite3 positional bind params`.

#### Commit `6994cd1f` — `fix(cursor): HTTP/2 AgentService support + version bump to 3.12.17`

| File | Verdict | Reason |
|------|---------|--------|
| `open-sse/executors/cursor.js` | **ACCEPT** | Pure cursor executor upgrade; no MW file conflict |
| `open-sse/handlers/chatCore.js` | **ACCEPT with review** | MW wires semaphore/breaker/undici into chatCore. Diff must be verified: the cursor change is additive (branch in tool dispatch), not modifying existing MW integration. If conflict, apply MW-side first then re-add cursor branch. |
| `open-sse/providers/registry/cursor.js` | **ACCEPT** | Provider metadata update only |
| `open-sse/services/cursorModels.js` | **ACCEPT** | New file; no conflict |
| `open-sse/utils/cursorChecksum.js` | **ACCEPT** | Minor update; no conflict |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | **REJECT** | Dashboard component change. MW uses its own dashboard. |
| `src/app/api/providers/[id]/models/route.js` | **ACCEPT** | API route for provider models; useful independent of dashboard |
| `src/app/api/v1/models/route.js` | **ACCEPT** | Models endpoint extension; no MW conflict |
| `src/shared/components/ModelSelectModal.js` | **ACCEPT** | Shared UI component; no MW conflict |
| `tests/__baseline__/providers-baseline.json` | **ACCEPT** | Baseline update to match new providers |
| `tests/unit/cursor-agent-proto.test.js` | **ACCEPT** | New test for cursor AgentService |
| `tests/unit/cursor-models.test.js` | **ACCEPT** | New test for cursor models |

**Action:** Extract patch with accepted files only. Apply as MW commit `feat(mw): integrate cursor AgentService HTTP/2 support`. Skip dashboard page change.

#### Commit `79918c78` — `# v0.5.40 (2026-07-20)` (release metadata)

| File | Verdict | Reason |
|------|---------|--------|
| `CHANGELOG.md` | **ACCEPT (merge)** | Add upstream v0.5.40 section under MW versioning scheme. MW changelog prefix must be preserved. |
| `package.json` | **ACCEPT conf-only** | Bump version from `0.5.35` to `0.5.40` in the upstream base; MW suffix `-mw.0` appended by our commit |
| `cli/package.json` | **ACCEPT conf-only** | Same version bump as package.json |
| `README.md` | **REJECT** | MW has its own README (enterprise production guide). Upstream README is for the stock product. MW README will be updated separately to note v0.5.40 base. |
| `open-sse/providers/capabilities.js` | **ACCEPT** | Upstream capability additions; no MW conflict |

**Action:** Extract patch with accepted files. Will produce MW commit `chore(mw): bump upstream base to v0.5.40`.

### 1.2 Cleanly Acceptable Upstream Commits (cherry-pick safe)

These 10 commits touch files that do not overlap with MW-specific code:

| Commit | Description | Files changed | MW conflict risk |
|--------|-------------|---------------|------------------|
| `c97963c4` | fix(translator): pass service_tier through OpenAI->Responses | translator/request/openai-responses.js | None |
| `cef5dd4d` | fix(kiro): map GPT-5.6 reasoning effort fields | executors/kiro.js, config/kiroConstants.js | None |
| `d587b2a4` | fix(codex): current client_version + refresh-aware model sync | chatCore/sseToJsonHandler.js | None |
| `7c7fae39` | fix(kiro): validate terminal streams before emitting output | executors/kiro.js | None |
| `9ba8f374` | feat(i18n): add Khmer language support | i18n/config.js, public/i18n/literals/km.json, locales, LanguageSwitcher | None (i18n only) |
| `55628eea` | fix(alicode-intl): split into Coding Plan + Model Studio | providers/registry/alicode-intl.js, alims-intl.js, index.js | None |
| `c4a120af` | docs(readme): update free-tier provider status | README.md | **REJECT** — MW uses own README |
| `eb00222c` | fix(kiro): map GPT reasoning effort fields | executors/kiro.js, translator/request/* | None |
| `43d4abbc` | docs(README): add Vietnamese OpenClaw Zalo video guide | README.md | **REJECT** — MW uses own README |
| `e0ba6674` | feat(cli-tools): configure Grok Build subagent models | src/lib/grokBuildConfig.js, src/app/api/cli-tools/*, tests/unit/grok-build-config.test.js, shared components | None (new feature) |

### 1.3 Cherry-Pick Sequence (guaranteed clean)

```
cherry-pick sequence:
  1. 9ba8f374  feat(i18n): add Khmer language support           (i18n only, no conflicts)
  2. 55628eea  fix(alicode-intl): split providers                (registry only, no conflicts)  
  3. e0ba6674  feat(cli-tools): configure Grok Build subagent    (new files, no conflicts)
  4. c97963c4  fix(translator): pass service_tier                (single file, no conflicts)
  5. cef5dd4d  fix(kiro): map GPT-5.6 reasoning effort          (kiro only)
  6. d587b2a4  fix(codex): client_version + model sync           (sseToJsonHandler only)
  7. 7c7fae39  fix(kiro): validate terminal streams              (kiro only)
  8. eb00222c  fix(kiro): map GPT reasoning effort fields        (kiro + translator)
```

These 8 cherry-picks apply cleanly and require no MW adaptation.

### 1.4 Patch-Applied MW Commits (after cherry-picks)

After the 8 clean cherry-picks, apply these as new MW commits:

```
MW commit 1 (from 4f48ab8c):
  fix(mw): spread better-sqlite3 positional bind params
  Files: src/lib/db/adapters/betterSqliteAdapter.js
  Change: (...params) instead of (params) in run/get/all

MW commit 2 (from 6994cd1f, accepted files only):
  feat(mw): integrate cursor AgentService HTTP/2 support
  Files: open-sse/executors/cursor.js, open-sse/handlers/chatCore.js,
         open-sse/providers/registry/cursor.js, open-sse/services/cursorModels.js,
         open-sse/utils/cursorChecksum.js, src/app/api/providers/[id]/models/route.js,
         src/app/api/v1/models/route.js, src/shared/components/ModelSelectModal.js,
         tests/__baseline__/providers-baseline.json, tests/unit/cursor-agent-proto.test.js,
         tests/unit/cursor-models.test.js
  Rejected: src/app/(dashboard)/dashboard/providers/[id]/page.js

MW commit 3 (from 79918c78, accepted files only):
  chore(mw): bump upstream base to v0.5.40
  Files: CHANGELOG.md, package.json, cli/package.json, open-sse/providers/capabilities.js
  Version: 0.5.40-mw.0
  Rejected: README.md (MW maintains own README)

MW commit 4 (MW-specific):
  docs(mw): upstream v0.5.40 integration plan and evidence directory
  Files: .sisyphus/plans/9router-mw-upstream-v0.5.40-production.md,
         docs/plans/9router-mw-upstream-v0.5.40-production-plan.md
```

### 1.5 Upstream Changes Rejected (with justification)

| Change | Commit | Reason for Rejection |
|--------|--------|---------------------|
| README.md updates | c4a120af, 43d4abbc, 79918c78 (partial) | MW maintains its own enterprise production README. Upstream README is stock product. |
| Dashboard page components | 6994cd1f (src/app/(dashboard)/.../page.js) | MW dashboard is separate; canceled after revert at ae993b19. No independent dashboard. |
| i18n UI components (if touched) | 9ba8f374 (partial UI) | MW does not ship the full upstream i18n switcher/locale UI in production; keep locale data but skip UI components only if they conflict. |

---

## 2. Isolated Staging Environment

### 2.1 Rationale

Staging on the same VPS verifies the integration under realistic conditions (same OS, Node version, Redis version, network topology) without risk to the production gateway. It uses:
- Port **20129** (production: 20128)
- Redis **6382** (production: 6381)
- Separate data/log directories
- Separate systemd unit name
- SQLite database copied from production (anonymized — no provider tokens)

### 2.2 Port Allocation

| Service | Production | Staging |
|---------|-----------|---------|
| Node app | 127.0.0.1:20128 | 127.0.0.1:20129 |
| Redis | 127.0.0.1:6381 | 127.0.0.1:6382 |
| Nginx | Not needed (direct curl/k6) | Optional direct access |

### 2.3 Directory Layout

```
/opt/9router-mw-staging/         # staging release root
  current -> releases/0.5.40-mw.0
  releases/
    0.5.40-mw.0/
/var/lib/9router-mw-staging/     # staging data (0700, router:router)
  db/
    data.sqlite                   # obfuscated copy (no provider tokens, no apiKeys)
  tokens/                         # empty (no token files)
  backups/
  logs/
/etc/9router-mw-staging/          # staging env config
  env                              # 0640 root:router
/etc/systemd/system/
  9router-mw-staging.service      # staging systemd unit
```

### 2.4 Redis Staging Container

```bash
docker run -d \
  --name 9router-mw-redis-staging \
  --restart unless-stopped \
  -p 127.0.0.1:6382:6379 \
  -v /var/lib/9router-mw-staging/redis:/data \
  redis:7-alpine \
  redis-server --requirepass "$(openssl rand -hex 32)" --maxmemory 128mb --maxmemory-policy allkeys-lru
```

**Port verification:** After creation, `redis-cli -p 6382 -a <password> PING` must return PONG.

### 2.5 Staging Env File

```
# /etc/9router-mw-staging/env — mode 0640 root:router
PORT=20129
HOSTNAME=127.0.0.1
HOST=127.0.0.1
WORKERS=4
NODE_ENV=production
DATA_DIR=/var/lib/9router-mw-staging
MW_REQUIRE_NATIVE_SQLITE=1
LOG_LEVEL=debug
ENABLE_REQUEST_LOGS=true
NODE_OPTIONS=--dns-result-order=ipv4first
REDIS_HOST=127.0.0.1
REDIS_PORT=6382
REDIS_PASSWORD=<random-32-hex>
REDIS_URL=redis://:<random-32-hex>@127.0.0.1:6382/0
```

**CRITICAL:** Staging env NEVER copies production REDIS_PASSWORD, JWT_SECRET, API_KEY_SECRET, provider tokens, or INITIAL_PASSWORD. All staging credentials are independently generated.

### 2.6 Staging Systemd Unit

```ini
[Unit]
Description=9router-MW staging gateway (v0.5.40 integration test)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=router
Group=router
WorkingDirectory=/opt/9router-mw-staging/current
EnvironmentFile=/etc/9router-mw-staging/env
ExecStart=/usr/bin/node --max-old-space-size=2048 custom-server.js
Restart=always
RestartSec=3
TimeoutStopSec=15
KillSignal=SIGTERM
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/9router-mw-staging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=9router-mw-staging

[Install]
WantedBy=multi-user.target
```

---

## 3. Implementation Tasks

### Task 3.1: Cherry-pick 8 clean upstream commits

**Command pattern (repeat for each of the 8 commits):**

```bash
GIT_MASTER=1 git cherry-pick <commit-hash>
# Resolve if any conflict; none expected
```

**Verify after each:**
```bash
GIT_MASTER=1 git log --oneline -1
GIT_MASTER=1 git diff --stat HEAD~1..HEAD
```

### Task 3.2: Apply better-sqlite3 bind fix patch

**Action:** Read patch from `4f48ab8c`, apply to `src/lib/db/adapters/betterSqliteAdapter.js`:

Change lines 42-44:
```js
run(sql, params = []) { return prepare(sql).run(...params); },
get(sql, params = []) { return prepare(sql).get(...params); },
all(sql, params = []) { return prepare(sql).all(...params); },
```

**Verify:** `GIT_MASTER=1 git diff HEAD -- src/lib/db/adapters/betterSqliteAdapter.js` shows only the three-line spread change.

**Commit:**
```bash
GIT_MASTER=1 git add src/lib/db/adapters/betterSqliteAdapter.js
GIT_MASTER=1 git commit -m "fix(mw): spread better-sqlite3 positional bind params"
```

### Task 3.3: Apply cursor AgentService patch (accepted files only)

**Action:** Extract the 11 accepted files from `6994cd1f` into a patch, applying only:
- `open-sse/executors/cursor.js`
- `open-sse/handlers/chatCore.js` (verify MW integration intact)
- `open-sse/providers/registry/cursor.js`
- `open-sse/services/cursorModels.js`
- `open-sse/utils/cursorChecksum.js`
- `src/app/api/providers/[id]/models/route.js`
- `src/app/api/v1/models/route.js`
- `src/shared/components/ModelSelectModal.js`
- `tests/__baseline__/providers-baseline.json`
- `tests/unit/cursor-agent-proto.test.js`
- `tests/unit/cursor-models.test.js`

**chatCore.js review gate:** Before staging deploy, verify that the chatCore.js diff is strictly additive (cursor branch in tool dispatch, no removal or modification of existing MW semaphore/breaker/undici wiring). If it modifies MW logic, the cursor change must be re-implemented as a wrapper rather than an inline edit.

**Commit:**
```bash
GIT_MASTER=1 git add <accepted files>
GIT_MASTER=1 git commit -m "feat(mw): integrate cursor AgentService HTTP/2 support"
```

### Task 3.4: Apply v0.5.40 metadata (accepted files only)

**Action:** Apply changes from `79918c78` to:
- `CHANGELOG.md` — merge upstream v0.5.40 section under MW changelog
- `package.json` — bump version to `0.5.40` (MW suffix added next)
- `cli/package.json` — bump version to `0.5.40`
- `open-sse/providers/capabilities.js` — upstream updates

**Version set:**
```bash
echo "0.5.40-mw.0" > VERSION
```

**Commit:**
```bash
GIT_MASTER=1 git add CHANGELOG.md package.json cli/package.json VERSION open-sse/providers/capabilities.js
GIT_MASTER=1 git commit -m "chore(mw): bump upstream base to v0.5.40"
```

### Task 3.5: Create staging provisioning script

Create `scripts/stage-upstream-v0.5.40.sh` — a script that runs on the VPS to:

1. Stop any existing staging service
2. Clone the branch to `/opt/9router-mw-staging/releases/0.5.40-mw.0`
3. Create env file at `/etc/9router-mw-staging/env` (template with random passwords — never from production)
4. Create directories: `/var/lib/9router-mw-staging/{db,tokens,backups,logs,redis}`
5. Set ownership: `chown -R router:router /opt/9router-mw-staging /var/lib/9router-mw-staging /etc/9router-mw-staging`
6. Set permissions: `chmod 0700 /var/lib/9router-mw-staging`, `chmod 0640 /etc/9router-mw-staging/env`
7. Start Redis staging container (`9router-mw-redis-staging`)
8. Verify Redis: `redis-cli -p 6382 -a <password> PING`
9. Run `npm install` in release dir
10. Run `npm run build` in release dir
11. Assemble standalone (following F6 packaging closure — see Task 3.6)
12. Install staging systemd unit
13. Start staging service
14. Wait 10s, verify health: `curl -s http://127.0.0.1:20129/api/health`
15. Report worker count (must be 4) and Redis connectivity

### Task 3.6: Standalone Assembly (production packaging closure)

The production packaging closure from `docs/deploy/f6-deploy-hotpath.sh` must be followed exactly:

1. Verify `.next/standalone/server.js` exists
2. Copy `custom-server.js` to standalone
3. Copy `.next/static` to standalone
4. Copy `public/` to standalone
5. Copy `open-sse/` to standalone
6. Copy `scripts/` to standalone
7. Copy runtime `node_modules`: `better-sqlite3`, `sql.js`, `ioredis`, `undici`, plus ioredis transitive deps

**Verification:**
```bash
ls -la /opt/9router-mw-staging/current/server.js
ls -la /opt/9router-mw-staging/current/custom-server.js
ls -d /opt/9router-mw-staging/current/node_modules/{ioredis,better-sqlite3,undici}
grep 'cluster.fork' /opt/9router-mw-staging/current/custom-server.js
```

### Task 3.7: Create staging smoke test script

Create `scripts/test/staging-smoke-v0.5.40.sh` that:

1. **Health gate:** 5 rapid calls to `http://127.0.0.1:20129/api/health`
   - Each must return HTTP 200
   - Each must have `ok: true`
   - Must see at least 2 unique `workerId` values (confirming multi-worker)
   - Response must include `redis.ok: true`
   - Must include `hotpath.undici.enabled: true`
   - Must include `hotpath.sqlite.driver: "better-sqlite3"`
   - Must include `hotpath.sqlite.journalMode: "wal"`

2. **Container verification:**
   ```bash
   docker ps --filter name=9router-mw-redis-staging --format '{{.Status}}' | grep -q 'Up'
   ss -tlnp | grep -q 20129
   ```

3. **Test runner verification:**
   ```bash
   cd tests && npx vitest run unit/cursor-agent-proto.test.js unit/cursor-models.test.js unit/grok-build-config.test.js unit/kiro-nonstream-error.test.js unit/kiro-terminal-integrity.test.js unit/openai-to-kiro.test.js
   ```
   - Known failures from `tests/__baseline__/known-fails.txt` are expected and not regressions.
   - Verify no NEW regressions: run regression baseline comparison.

4. **Concurrent claim test:**
   ```bash
   REDIS_HOST=127.0.0.1 REDIS_PORT=6382 node scripts/tests/mw-concurrent-claim.mjs
   ```

5. **k6 light smoke (if k6 available):**
   ```bash
   k6 run --vus 20 --duration 15s -e BASE_URL=http://127.0.0.1:20129 <(echo '
     import http from "k6/http";
     import { check } from "k6";
     export default function() {
       const r = http.get(`${__ENV.BASE_URL}/api/health`);
       check(r, { "status 200": (res) => res.status === 200 });
     }
   ')
   ```

### Task 3.8: Health Gate Specification

The health response contract at `GET /api/health`:

```json
{
  "ok": true,
  "workerId": "w1",
  "workers": 4,
  "redis": {
    "ok": true,
    "mode": "shared"
  },
  "hotpath": {
    "undici": { "enabled": true, "connections": 32 },
    "sqlite": {
      "driver": "better-sqlite3",
      "journalMode": "wal",
      "file": "/var/lib/9router-mw-staging/db/data.sqlite"
    }
  },
  "version": "0.5.40-mw.0"
}
```

**Independent verification (socket + container):**
```bash
# Socket level
ss -tlnp | grep 20129
# Must show LISTEN state

# Container level
docker ps --filter name=9router-mw-redis-staging --format '{{.Names}} {{.Status}}'
# Must show "9router-mw-redis-staging Up ..."

# Foreign Redis untouched
docker ps --filter name=ggl-redis --format '{{.Names}} {{.Status}}'
docker ps --filter name=app-redis-1 --format '{{.Names}} {{.Status}}'
```

### Task 3.9: Staging Cleanup (after production rollout)

```bash
# Stop and remove staging service
systemctl stop 9router-mw-staging
systemctl disable 9router-mw-staging
rm /etc/systemd/system/9router-mw-staging.service
systemctl daemon-reload

# Remove staging Redis container
docker stop 9router-mw-redis-staging
docker rm 9router-mw-redis-staging

# Remove staging directories
rm -rf /opt/9router-mw-staging
rm -rf /var/lib/9router-mw-staging
rm -rf /etc/9router-mw-staging

# Do NOT run docker volume prune — this is a global operation that could remove
# volumes belonging to other services (ggl-redis, app-redis-1, etc.)
# Staging Redis data was on a bind mount already removed above.
```

**NEVER run:**
- `docker volume prune` (global — could delete other services' volumes)
- `docker system prune` (too aggressive for multi-tenant VPS)
- `npm cache clean --force` (not necessary; wastes rebuild time)

---

## 4. Gated Production Rollout

### 4.1 Production Gate Checklist

All items REQUIRED before production deploy:

| # | Check | Method | Pass criteria |
|---|-------|--------|---------------|
| PG1 | Staging health | `curl http://127.0.0.1:20129/api/health` | 200, ok:true, 4 workers, redis OK, undici, wal |
| PG2 | Staging smoke tests | Run staging smoke script | All GREEN |
| PG3 | Staging concurrent claim | `mw-concurrent-claim.mjs` against staging Redis | No double-claim |
| PG4 | Staging k6 smoke | 20 VU x 15s | 0% errors |
| PG5 | Staging chatCore review | Manual diff of chatCore.js | MW sem/breaker/undici wiring intact |
| PG6 | Production DB backup | Run before deploy | Backup file exists, recent timestamp |
| PG7 | Production release assembly | Build + standalone pack on VPS | `.next/standalone/server.js` exists |
| PG8 | Rollback target confirmed | `ls /opt/9router-mw/releases/` | Previous release dir exists |
| PG9 | Source/tag/release timing | Tag, push, then deploy | No deploy before tag push completes |

### 4.2 Production Deploy Steps

1. **Tag the release:**
   ```bash
   git tag -a v0.5.40-mw.0 -m "9router-mW v0.5.40-mw.0 — selective upstream integration"
   git push origin master --tags
   ```

2. **Push to origin:**
   ```bash
   git push origin master
   ```

3. **On VPS, provision production release:**
   ```bash
   # Use production deploy procedure (docs/runbooks/deploy.md) with RELEASE_ID=0.5.40-mw.0
   # Deploy to /opt/9router-mw/releases/0.5.40-mw.0
   # Follow F6 standalone assembly closure (same as Task 3.6 but to production path)
   ```

4. **Production health gate:**
   ```bash
   curl -s http://127.0.0.1:20128/api/health | jq .
   # Verify: ok=true, workerId rotates, redis.ok=true, undici.enabled=true, sqlite.driver=better-sqlite3
   ```

5. **Public health verification:**
   ```bash
   curl -sS https://example.com/api/health | jq .
   # Same contract verification through Nginx + Cloudflare
   ```

6. **Production invariants verification (MUST):**
   ```bash
   # Workers = 4
   curl -s http://127.0.0.1:20128/api/health | jq '.workers'
   
   # Redis port 6381 only (staging Redis 6382 must NOT be in production REDIS_URL)
   grep REDIS_PORT /etc/9router-mw/env
   
   # Foreign Redis untouched
   redis-cli -p 6379 PING 2>/dev/null | head -1
   redis-cli -p 6380 PING 2>/dev/null | head -1
   
   # no sql.js
   curl -s http://127.0.0.1:20128/api/health | jq '.hotpath.sqlite.driver'
   
   # MITM off
   curl -s http://127.0.0.1:20128/api/health | jq '.mitm // "absent"'
   ```

### 4.3 Rollback Procedure

If production health gates fail:

```bash
# Fast rollback
ln -sfn /opt/9router-mw/releases/<previous-release> /opt/9router-mw/current
systemctl restart 9router-mw
sleep 5
curl -s http://127.0.0.1:20128/api/health

# If Redis MISCONF
chown -R 999:999 /var/lib/9router-mw/redis
docker restart 9router-mw-redis
systemctl restart 9router-mw
```

**Do not delete the new release directory until verified stable for 24h.**

---

## 5. Git Commit Plan (atomic sequence)

All commits on branch `integration/v0.5.40`. After Momus approval and successful staging, merged to `master`.

```
Branch: integration/v0.5.40 (from master@ae993b19)

01  9ba8f374  cherry-pick "feat(i18n): add Khmer language support"
02  55628eea  cherry-pick "fix(alicode-intl): split into Coding Plan + Model Studio"
03  e0ba6674  cherry-pick "feat(cli-tools): configure Grok Build subagent models"
04  c97963c4  cherry-pick "fix(translator): pass service_tier through OpenAI->Responses"
05  cef5dd4d  cherry-pick "fix(kiro): map GPT-5.6 reasoning effort fields"
06  d587b2a4  cherry-pick "fix(codex): current client_version + refresh-aware model sync"
07  7c7fae39  cherry-pick "fix(kiro): validate terminal streams before emitting output"
08  eb00222c  cherry-pick "fix(kiro): map GPT reasoning effort fields"
09  (new)     fix(mw): spread better-sqlite3 positional bind params
10  (new)     feat(mw): integrate cursor AgentService HTTP/2 support
11  (new)     chore(mw): bump upstream base to v0.5.40
12  (new)     docs(mw): upstream v0.5.40 integration plan and evidence

Merge to master: GIT_MASTER=1 git checkout master
                  GIT_MASTER=1 git merge --no-ff integration/v0.5.40
                  GIT_MASTER=1 git tag v0.5.40-mw.0
```

Commit 12 includes the plan document and evidence directory skeleton:
```
.sisyphus/plans/9router-mw-upstream-v0.5.40-production.md
docs/plans/9router-mw-upstream-v0.5.40-production-plan.md
docs/evidence/v0.5.40/.gitkeep
```

**Anti-patterns (DO NOT):**
- No `git merge --squash` — preserves individual commit authorship and atomicity
- No `-X theirs` conflict resolution — each conflict resolved manually
- No `git rebase` of the integration branch onto master after creation (merge instead)
- No `git commit --amend` on cherry-picked commits (preserve upstream author)
- No blind merge: verify each cherry-pick produces correct diff before proceeding

---

## 6. Evidence Requirements

After each phase, output to `docs/evidence/v0.5.40/`:

| Evidence | Source | File |
|----------|--------|------|
| Cherry-pick log | `git log --oneline` | `01-cherry-picks.txt` |
| Commit diff stats | `git diff --stat` | `02-commit-diffs.txt` |
| Staging health response | `curl -s http://127.0.0.1:20129/api/health` | `03-staging-health.json` |
| Staging health socket | `ss -tlnp \| grep 20129` | `04-staging-socket.txt` |
| Staging Redis container | `docker ps` | `05-staging-redis.txt` |
| Staging smoke test output | Script stdout | `06-staging-smoke.txt` |
| chatCore.js review diff | Manual review notes | `07-chatcore-review.txt` |
| Production health post-deploy | `curl -s ...` | `08-production-health.json` |
| Production invariants | Commands from §4.2 step 6 | `09-production-invariants.txt` |
| Foreign Redis untouched | `redis-cli -p 6379/6380 PING` | `10-foreign-redis.txt` |
| Staging cleanup log | Cleanup script output | `11-staging-cleanup.txt` |
| Rollback drill (if done) | Command output | `12-rollback-drill.txt` |

---

## 7. MW Production Invariants (NEVER VIOLATE)

```
1.  Workers always 4 — no WORKERS=1 production default
2.  Redis only port 6381 — never 6379/6380
3.  SQLite only better-sqlite3 + WAL — no sql.js in production
4.  MITM OFF in production
5.  Bind localhost — public only via Nginx
6.  No secrets in git
7.  No double-request (cluster is capacity, not fan-out)
8.  Provider credentials never leave production env
9.  Dashboard execution canceled — no independent dashboard
10. cf. Cancelled dashboard decision recorded at ae993b19
```

---

## 8. Post-Implementation Review

After production rollout and staging cleanup, run post-implementation review:

1. **Goal verification** — All integration objectives met:
   - [ ] Upstream v0.5.40 features integrated (selected set)
   - [ ] better-sqlite3 bind fix applied
   - [ ] Cursor AgentService available
   - [ ] Version bumped to 0.5.40-mw.0
   - [ ] No MW invariants violated

2. **Security review** — No secrets exposed, no credentials copied to staging:
   - [ ] Staging env had independent credentials
   - [ ] No production tokens in staging SQLite copy
   - [ ] Staging directories cleaned up

3. **Staging cleanup confirmed:**
   - [ ] `9router-mw-staging` service stopped and removed
   - [ ] `9router-mw-redis-staging` container removed
   - [ ] `/opt/9router-mw-staging` removed
   - [ ] `/var/lib/9router-mw-staging` removed
   - [ ] `/etc/9router-mw-staging` removed

4. **Git health:**
   - [ ] Branch `integration/v0.5.40` merged to master
   - [ ] Tag `v0.5.40-mw.0` pushed
   - [ ] All 12 commits in history
   - [ ] No duplicate or broken commits

5. **Operations:**
   - [ ] Production health = 200, 4 workers, Redis OK
   - [ ] Rollback target confirmed on disk
   - [ ] Public HTTPS verified
   - [ ] 24h watch period started

---

## 9. Privacy & Security Rules

1. **No real domains or IPs in plan files.** Use `example.com`, `[REDACTED-VPS]`, `[REDACTED-HOST]`.
2. **No production credentials** in any plan or script committed to git.
3. **Staging uses independent credentials** generated fresh, never copied from production.
4. **Staging SQLite is obfuscated** — provider tokens, apiKeys, and sensitive config are NOT copied.
5. **No secrets in git** — verify with `git diff --cached` before each commit.

---

## 10. Plan Review Gate

**BEFORE any implementation begins:**

1. Momus (review agent) must APPROVE this plan at `.sisyphus/plans/9router-mw-upstream-v0.5.40-production.md`.
2. Approval criteria:
   - All commit extraction matrices are complete with file-level accept/reject
   - Staging isolation is comprehensive (ports, dirs, credentials, Redis)
   - Production gate includes DB backup, release assembly verification, rollback target, source/tag/release timing
   - Cleanup removes only named staging resources (no global prune)
   - Health gates match actual response contract plus independent socket/container verification
   - No `docker volume prune` or similar global cleanup
   - Test commands derived from actual package/test scripts
   - All MW invariants preserved
   - Canceled dashboard absence confirmed
3. After Momus approval, proceed with implementation in order:
   - Cherry-picks
   - Patch applications
   - Staging provisioning
   - Staging verification
   - Production gate
   - Production deploy
   - Staging cleanup
   - Post-implementation review

---

*Plan prepared 2026-07-20. Current HEAD: ae993b19. Upstream v0.5.40: 79918c78. Merge base: 0513bf39.*
*Candidate version: 0.5.40-mw.0.*
*Staging: port 20129 / Redis 6382. Production: port 20128 / Redis 6381.*
