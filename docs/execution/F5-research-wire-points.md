# F5 Research — Wire Points (Semaphore / Breaker / Settings Cache)

**Date:** 2026-07-19  
**Version target:** `0.5.35-mw.3`  
**SSOT:** `docs/plans/9router-mw-production-plan.md` §F5 + design §3.2  
**Prior modules (F4, not wired):** `open-sse/services/{redisClient,accountSemaphore,circuitBreaker,usageBuffer}.js`  
**Live baseline:** VPS mw.2 HEAD `966ca5f7`, Redis `127.0.0.1:6381`, PASS_REDIS claim 5/5

---

## Plan F5 (locked)

1. Diff Vans: **only** semaphore / circuit-breaker / settings-cache patterns  
2. Wire into account selection path (not provider-agnostic chatCore)  
3. Settings memory cache **≤5s** per worker  
4. **Do not** port Vans ACL / ponytail / dashboard extras  

**Exit:** code review checklist; behavior matches design §3.2 wire order

---

## Design §3.2 wire order (request path)

1. Client → CF → Nginx → one of 4 workers  
2. Auth API key → parse model → combo/account select  
3. **Circuit breaker** — skip OPEN; allow HALF probe; close on success  
4. **Semaphore Redis** `mw:sem:{accountId}` — claim; full → other account / 429  
5. Settings memory cache ≤5s else SQLite  
6. Translate + RTK → executor.execute (undici)  
7. Stream SSE  
8. Usage → Redis buffer → SQLite (F4 module; wire optional later)  
9. **Release semaphore** in `finally`

---

## Wire target A — `src/sse/handlers/chat.js`

**Function:** `handleSingleModelChat` — `while (true)` account fallback loop (~L198–286)

### Insert after credentials resolved, before `handleChatCore`

| Step | Action | On fail |
|------|--------|---------|
| 1 | `connId = credentials.connectionId` | — |
| 2 | Skip if `!connId \|\| connId === "noauth"` | continue existing path |
| 3 | `getBreakerState(connId)` | if `!allow` → `excludeConnectionIds.add` + `continue` |
| 4 | `acquireAccountSlot(connId)` | if `!acquired` → exclude + continue (not mark unavailable) |
| 5 | `try { handleChatCore... }` | |
| 6 | success → `recordBreakerSuccess(connId)` + return | |
| 7 | fail → `markAccountUnavailable` as today; if `shouldFallback && status !== 429` → `recordBreakerFailure` | 429 excluded from breaker (Vans pattern) |
| 8 | `finally { releaseAccountSlot(connId) }` | always |

### Imports (open-sse services, already in standalone assemble)

```js
import {
  acquireAccountSlot,
  releaseAccountSlot,
} from "open-sse/services/accountSemaphore.js";
import {
  getBreakerState,
  recordBreakerSuccess,
  recordBreakerFailure,
} from "open-sse/services/circuitBreaker.js";
```

### MUST NOT

- Edit `open-sse/handlers/chatCore.js` (provider-agnostic)  
- Port Vans ACL / ponytail / dashboard  
- Use Redis ports 6379/6380  
- Double-record breaker failure in both `chat.js` and `markAccountUnavailable` (record only in chat loop)

### Note on `selectionMutex` (`auth.js`)

Per-process only. Cross-worker exclusivity is **Redis semaphore**, not mutex.

---

## Wire target B — Settings cache 5s

### Primary: `src/lib/db/repos/settingsRepo.js`

| Symbol | Behavior |
|--------|----------|
| `_settingsCache` + `_settingsCacheAt` | in-memory per worker |
| `SETTINGS_CACHE_TTL_MS = 5000` | overridable via `MW_SETTINGS_CACHE_MS` |
| `getSettings()` | return cache if fresh; else `readRaw` + merge + store |
| `updateSettings()` | after write → `invalidateSettingsCache()` |
| `invalidateSettingsCache()` | exported; clears cache |

### Companion: `src/lib/db/index.js` `importDb()`

After DB transaction that rewrites `settings` → call `invalidateSettingsCache()`  
(Vans missed this; we fix it.)

### Hot callers (benefit from cache, no code change)

- `chat.js` `getSettings` (multiple per request)  
- `auth.js`  
- dashboard guards  

### Re-export

Optional: export `invalidateSettingsCache` from `src/lib/db/index.js` for tests; not required for runtime.

---

## Vans patterns (reference only — do not copy tree)

| Piece | Vans behavior | Our F5 |
|-------|---------------|--------|
| Semaphore | in-memory Map FIFO, maxConcurrency 3 | Redis Lua `mw:sem:{id}`, max default 1, fail-open local Map |
| Breaker | CLOSED→DEGRADED→OPEN→HALF; 429 excluded | CLOSED→OPEN→HALF via Redis HASH; 429 excluded on record |
| Settings | 5s TTL in settingsRepo | 5s TTL + invalidate on update + importDb |
| Wire order | breaker → credentials → semaphore → chatCore | credentials → breaker → semaphore → chatCore (selection already done) |

---

## Code review checklist (F5 exit)

- [ ] Breaker OPEN accounts never enter `handleChatCore`  
- [ ] Semaphore acquired always released in `finally`  
- [ ] noauth path unchanged (no Redis claim)  
- [ ] 429 does not open breaker  
- [ ] Settings cache TTL ≤5s; update/import invalidate  
- [ ] No Vans ACL/ponytail/dashboard code  
- [ ] Redis only `127.0.0.1:6381`  
- [ ] Version `0.5.35-mw.3`  
- [ ] Health still `{ok, workerId, pid, workers, redis}`  
- [ ] Deploy: 4 workers, PASS_REDIS, k6 no 502 storm  

---

## Deploy / version

- Bump: `package.json`, `cli/package.json`, `VERSION` → `0.5.35-mw.3`  
- Script: `docs/deploy/f5-deploy-resilience-wire.sh` (from f4 template)  
- Evidence: `docs/evidence/phase-05/`  

---

## Out of scope F5

- usageBuffer wire into usageRepo (can be F6/later)  
- Hot-path undici Agent / SQLite WAL (F6)  
- Load prove §5 gate (F7)  
