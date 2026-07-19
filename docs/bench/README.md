# Bench — 9router-mw

Load test scripts and reports (k6 / mock).

**Final load gate:** [`report-mw-20260719.md`](./report-mw-20260719.md) — **§5 GREEN** (2.53× baseline).  
**Release status:** [`docs/RELEASE.md`](../RELEASE.md)

## Success gates (plan §5)

| Gate | Result |
| ---- | ------ |
| 200 concurrent | PASS |
| ≥1.5× throughput vs single-process baseline | **2.53×** PASS |
| p95 TTFB (health) < 2s | **241ms** PASS |
| Error rate < 1% | **0%** PASS |
| No double-request | 1:1 mock PASS |
| Always 4 workers | PASS |
| Worker respawn < 5s | **1s** PASS |
| Full restart < 30s | **~2.8s** PASS |
| Soak | PASS (waiver 10m@100 VU vs plan 30m) |

## Layout

| Path | Purpose |
| ---- | ------- |
| `baseline-single-20260718-summary.md` | F2 single-process baseline (~358 rps) |
| `report-mw-20260719.md` | F7 multi-worker load report |
| `k6-*.js` | health ramp, mock upstream, soak scripts |
| Evidence | `docs/evidence/phase-02/`, `phase-07/` |
