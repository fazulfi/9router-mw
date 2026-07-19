# Phase-07 Evidence — F7 Load Prove

**Version:** `0.5.35-mw.4`  
**Goal:** Prove §5 acceptance: 200 VU, ≥1.5× baseline, p95&lt;2s, err&lt;1%, soak, chaos, no double upstream.

## Checklist

- [ ] Mock upstream + metrics counter
- [ ] k6 mock: PASS_NO_DOUBLE
- [ ] k6 ramp 200: PASS_1_5X / PASS_P95 / PASS_ERR
- [ ] Soak (default 10m @ 100 VU; note if &lt;30m)
- [ ] Chaos kill worker respawn &lt;5s; full restart &lt;30s
- [ ] Report `docs/bench/report-mw-YYYYMMDD.md`
- [ ] Foreign redis untouched
