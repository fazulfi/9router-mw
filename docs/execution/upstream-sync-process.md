# F9 — Monthly upstream sync (v1 process)

Canonical procedure: **`docs/runbooks/upstream-sync.md`**.

## Schedule

- Monthly (or after critical upstream security fixes)
- Owner: Implementation Owner / on-call

## Quick checklist

1. `git fetch upstream`
2. Branch `sync/YYYY-MM`
3. Merge `upstream/master` — **MW files win** on cluster/redis/sem/breaker/undici/driver
4. Bump `0.x.y-mw.N`
5. VPS smoke + short k6
6. Tag + push
7. Note in `docs/execution/upstream-sync-YYYY-MM.md`

## Remotes

| Remote | URL |
|--------|-----|
| origin | fazulfi/9router-mw |
| upstream | decolua/9router |
| vans | Vanszs/VansRouter (read-only ref) |

## Out of scope v1

Automated CI load test; full Vans feature ports.
