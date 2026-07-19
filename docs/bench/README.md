# Bench — 9router-mw

Enterprise load evidence: synthetic k6 gates **and** production organic soak.

| Report | Role | Headline |
| ------ | ---- | -------- |
| [`report-mw-20260719.md`](./report-mw-20260719.md) | §5 synthetic load gate | **2.53×** · 905.5 rps · 0% err |
| [`report-production-soak-20260719.md`](./report-production-soak-20260719.md) | **Production organic + post-fix** | **~166 RPM avg** · peak **~278** · 0× 5xx |
| [`docs/RELEASE.md`](../RELEASE.md) | Release SSOT | PRODUCTION FINAL |

## Success gates (plan §5) — GREEN

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
| Soak (k6) | PASS (waiver 10m@100 VU vs plan 30m) |
| Production organic soak | **PASS** — see production report |

## Production organic (showcase)

| Metric | Value |
| ------ | ----- |
| Mode | Organic API traffic (real clients) |
| RPM average | **~166** |
| Peak RPM | **~278** |
| 5xx | **0** |
| Workers | **4** · Redis live ring global |
| Full write-up | [`report-production-soak-20260719.md`](./report-production-soak-20260719.md) |

> **Units:** k6 reports use **RPS** (health path). Organic tables use **RPM** (nginx `/v1` deltas). Do not mix.

## Layout

| Path | Purpose |
| ---- | ------- |
| `baseline-single-20260718-summary.md` | F2 single-process baseline (~358 rps) |
| `report-mw-20260719.md` | F7 multi-worker synthetic load report |
| `report-production-soak-20260719.md` | Post-go-live organic + live-usage fix evidence |
| `k6-*.js` | health ramp, mock upstream, soak scripts |
| Evidence | `docs/evidence/phase-02/`, `phase-07/` |
