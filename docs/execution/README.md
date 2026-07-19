# Execution Logs — 9router-mw

Chronological execution notes per phase. SSOT plan: [`docs/plans/9router-mw-production-plan.md`](../plans/9router-mw-production-plan.md).  
**Final release:** [`docs/RELEASE.md`](../RELEASE.md) · tag `v0.5.35-mw.6`

| Phase | Status | Notes |
| ----- | ------ | ----- |
| 0 Bootstrap | **DONE** | fork, remotes, base tag, version, docs skeleton |
| 1 VPS prep | **DONE** | user router, Redis 6381, dirs |
| 2 Baseline | **DONE** | single-process + nginx + k6 |
| 3 Multi-worker | **DONE** | cluster.fork ×4 |
| 4 Redis shared | **DONE** | semaphore, breaker, usage |
| 5 Vans port | **DONE** | resilience only |
| 6 Hot-path | **DONE** | undici, SQLite WAL, logs |
| 7 Load prove | **DONE** GREEN | k6 gate §5 (2.53×) |
| 8 Production | **DONE** | systemd, backup, public HTTPS go-live |
| 9 Operate | **DONE** | data migration + final release docs |

## Key logs

| Doc | Content |
| --- | ------- |
| [`phase-00-bootstrap.md`](./phase-00-bootstrap.md) | Bootstrap |
| [`F5-research-wire-points.md`](./F5-research-wire-points.md) | Resilience wire research |
| [`F6-research-hotpath.md`](./F6-research-hotpath.md) | Hot-path research |
| [`F7-research-load-prove.md`](./F7-research-load-prove.md) | Load prove research |
| [`phase-09-finalize.md`](./phase-09-finalize.md) | Finalize + migration |
| [`upstream-sync-process.md`](./upstream-sync-process.md) | Monthly upstream process |

## Rules

- One entry per significant step (date UTC+7 / Asia/Bangkok).
- Link evidence under `docs/evidence/phase-NN/`.
- Never store secrets (Redis password, API keys) in this tree.
