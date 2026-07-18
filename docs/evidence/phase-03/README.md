# Phase 03 — Multi-worker skeleton (Fase 3)

## Goal

Always 4 workers via `cluster.fork` in `custom-server.js`; `/api/health` exposes `workerId` + `pid`.

## Exit criteria (plan)

- [x] 4 worker PIDs under primary
- [x] Health samples show multiple distinct `workerId` values
- [x] Single listen on `127.0.0.1:20128` (shared port, no double-bind)
- [x] k6 smoke no 502 storm
- [x] Version `0.5.35-mw.1` deployed

## Result summary (2026-07-18 UTC)

| Check | Result |
| ----- | ------ |
| Release | `/opt/9router-mw/releases/0.5.35-mw.1` HEAD `a5da773e` |
| Version | `0.5.35-mw.1` |
| systemd | active; MainPID primary `477394` |
| Workers | `WORKER_CHILDREN=4` PIDs `477402 477403 477404 477410` |
| Health | 20 samples → workerIds `1,2,3,4` each 5×; `workers=4` |
| Listen | single `127.0.0.1:20128` on primary |
| Models | `/api/v1/models` HTTP 200 |
| k6 smoke | 20 VU × 15s: **11078** reqs, **0%** fail, checks 100%, ~**737 rps** |
| Foreign | ggl-redis 6379, app-redis 6380, mw-redis 6381 all up |

## Evidence files

| File | Content |
| ---- | ------- |
| `00-start.txt` | deploy start timestamp |
| `01-env-workers.txt` | WORKERS=4 HOSTNAME PORT NODE_ENV |
| `02-git-head.txt` / `02-version.txt` | release HEAD + version |
| `03-npm-install.txt` | npm install log |
| `04-build.txt` | next build log |
| `05-custom-server-grep.txt` | cluster.fork markers in standalone |
| `05-standalone.txt` / `06-current-link.txt` | standalone path + symlink |
| `07-systemd-*.txt` / `07-journal.txt` | service active + primary fork logs |
| `08-processes.txt` / `08-worker-pids.txt` | process tree + 4 children |
| `09-listen.txt` | ss 20128 single bind |
| `10-health-samples.txt` / `10-worker-ids.txt` | rotating workerId proof |
| `11-models.txt` | models smoke |
| `12-foreign-ok.txt` | redis isolation |
| `13-k6-smoke.txt` / `13-k6-summary.json` | load smoke |
| `99-done.txt` | deploy complete |

## Notes

- Account-selection races across workers without Redis shared state: **expected / OK for F3** (plan). Fixed in F4+.
- MITM/tunnel remain OFF; multi-worker bootstrap risk low.
- Throughput smoke ~2× single-process baseline health rps (358 → 737) under lighter 15s window — directional only; formal §5 gate is F7.
