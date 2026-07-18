# k6 baseline single-process — 2026-07-18

| Metric | Value |
| ------ | ----- |
| Target | `http://127.0.0.1:20128/api/health` |
| Scenario | 20 constant VUs, 60s |
| Iterations / requests | 21503 |
| Throughput | ~358 req/s |
| http_req_failed | 0.00% |
| checks | 100% |
| http_req_duration avg | 5.19ms |
| http_req_duration p95 | 18.9ms |
| http_req_duration max | 388.91ms |
| k6 | v2.0.0 |

Raw: `docs/bench/baseline-single-20260718.json`  
Script: `docs/bench/k6-baseline-health.js`

This is the **single-process** reference for ≥1.5× multi-worker comparison in later phases.
