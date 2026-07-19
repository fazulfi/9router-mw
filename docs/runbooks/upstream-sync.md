# Runbook — Monthly upstream sync (F9)

## Goal

Pull features/fixes from `decolua/9router` without losing MW multi-worker / Redis / resilience changes.

## Remotes

```bash
git remote -v
# origin   → fazulfi/9router-mw
# upstream → decolua/9router
# vans     → Vanszs/VansRouter (reference only)
```

## Procedure

1. `git fetch upstream --tags`
2. Branch: `git checkout -b sync/YYYY-MM master`
3. Merge or rebase: `git merge upstream/master` (or `upstream/main` if renamed)
4. **Conflict policy — MW wins** on:
   - `custom-server.js` (cluster.fork ×4)
   - `open-sse/services/redisClient.js`, `accountSemaphore.js`, `circuitBreaker.js`, `usageBuffer.js`
   - `open-sse/utils/proxyFetch.js` (undici Agent)
   - `src/sse/handlers/chat.js` (sem/breaker wire)
   - `src/lib/db/driver.js`, `settingsRepo.js`
   - `docs/deploy/*`, systemd, env.example
5. Bump `0.x.y-mw.N` in package.json / VERSION / cli
6. Smoke: build locally if possible; VPS deploy + health + k6 20 VU 15s
7. Tag: `git tag v0.x.y-mw.N && git push origin master --tags`
8. Record notes in `docs/execution/upstream-sync-YYYY-MM.md`

## Do not

- Port Vans ACL/dashboard  
- Share Redis with ggl/app  
- Drop `MW_REQUIRE_NATIVE_SQLITE`  
