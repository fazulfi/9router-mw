# Execution Logs — 9router-mw

Chronological execution notes per phase. SSOT plan: [`docs/plans/9router-mw-production-plan.md`](../plans/9router-mw-production-plan.md).

| Phase | Status | Notes |
| ----- | ------ | ----- |
| 0 Bootstrap | in progress | fork, remotes, base tag, version, docs skeleton |
| 1 VPS prep | pending | user router, Redis 6381, dirs |
| 2 Baseline | pending | single-process + nginx + k6 |
| 3 Multi-worker | pending | cluster.fork ×4 |
| 4 Redis shared | pending | semaphore, breaker, usage |
| 5 Vans port | pending | resilience only |
| 6 Hot-path | pending | undici, SQLite WAL, logs |
| 7 Load prove | pending | k6 gate §5 |
| 8 Production | pending | systemd, backup, go-live |
| 9 Operate | pending | monthly upstream sync notes |

## Rules

- One entry per significant step (date UTC+7 / Asia/Bangkok).
- Link evidence under `docs/evidence/phase-NN/`.
- Never store secrets (Redis password, API keys) in this tree.
