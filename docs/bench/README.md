# Bench — 9router-mw

Load test scripts and reports (k6 / mock).

## Success gates (plan §5)

- 200 concurrent
- ≥1.5× throughput vs single-process baseline
- No double-request
- Always 4 workers

## Layout

- `baseline/` — phase-02 single-process
- `mw/` — multi-worker after phases 3–6
- `reports/` — dated JSON/HTML summaries
