# F7 Research — Load Prove (§5 gate)

**Date:** 2026-07-19  
**Version live:** `0.5.35-mw.4`  
**SSOT:** plan §5 + §Fase 7

## Success criteria §5

| Metric | Target | Method |
|--------|--------|--------|
| Concurrent | 200 VU | k6 |
| Throughput | ≥1.5× single baseline | k6 vs baseline-single-20260718 (~358 rps @ 20 VU health) |
| p95 TTFB mock | < 2s | k6 |
| Error rate | < 1% | k6 |
| Soak | 30m @ 100–200 VU no unbounded mem | k6 + ps (pragmatic: 10–15m if time; note waiver if shorter) |
| Restart recovery | worker replace <5s; full restart <30s | kill -9 |
| No double upstream | 1 client → 1 upstream | mock counter |
| Data safety | credentials survive restart | smoke |

## Baseline (F2)

- 20 VU × 60s health: **~358 rps**, p95 ~18.9ms, 0% fail  
- 1.5× target ≈ **≥537 rps** on comparable scenario

## Multi already (F6 smoke)

- 20 VU × 15s: **~631 rps** (1.76×) — good signal

## Artifacts to produce

1. `scripts/mock-upstream-server.mjs` — fixed latency + counter  
2. `docs/bench/k6-load-health-200.js` — ramp 0→200  
3. `docs/bench/k6-soak-health.js` — long hold  
4. `docs/deploy/f7-load-prove.sh`  
5. `docs/bench/report-mw-20260719.md`  
6. `docs/evidence/phase-07/*`  

## Out of scope

- Real provider burn (low QPS smoke optional F8)  
- Changing worker count  
