# Phase 03 — Multi-worker skeleton (Fase 3)

## Goal

Always 4 workers via `cluster.fork` in `custom-server.js`; `/api/health` exposes `workerId` + `pid`.

## Exit criteria (plan)

- [ ] 4 worker PIDs under primary
- [ ] Health samples show multiple distinct `workerId` values
- [ ] Single listen on `127.0.0.1:20128` (shared port, no double-bind)
- [ ] k6 smoke no 502 storm
- [ ] Version `0.5.35-mw.1` deployed

## Evidence files

Captured after `docs/deploy/f3-deploy-multiworker.sh` on VPS.
