# Phase-07 Evidence — F7 Load Prove

**Version:** live `0.5.35-mw.4` + scripts `0.5.35-mw.5`  
**Report:** `docs/bench/report-mw-20260719.md`

## Exit — MET

| Check | Result |
|-------|--------|
| PASS_NO_DOUBLE | mock 24444 = k6 24444 (ratio 1.0) |
| PASS_1_5X | 905.5 rps vs 358 baseline → **2.529×** |
| PASS_P95 | 240.6 ms < 2000 |
| PASS_ERR | 0% fail |
| Soak | 10m @ 100 VU, 0% fail (waiver vs 30m) |
| Chaos respawn | 1s |
| Full restart | 2787 ms |
| Foreign redis | OK |
