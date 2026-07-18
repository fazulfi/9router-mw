# Phase-02 — Baseline single-process deploy (Fase 2)

**Date:** 2026-07-18 UTC  
**Release:** `0.5.35-mw.0` @ `8d8dca57`  
**Host:** `faiz-prod-01` (`root@82.25.62.204`)

## Outcome

| Check | Result |
| ----- | ------ |
| systemd `9router-mw` | `active` (User=router) |
| Listen | `127.0.0.1:20128` |
| Health | `{"ok":true}` |
| Version | `0.5.35-mw.0` |
| `/api/v1/models` | HTTP 200 |
| Nginx `router.budgezen.com` (local resolve) | health OK |
| DB driver | `better-sqlite3` → `/var/lib/9router-mw/db/data.sqlite` |
| Redis MW | `127.0.0.1:6381` (untouched foreign 6379/6380) |
| k6 baseline | 20 VUs × 60s → **21503 req**, **0% fail**, p95 **~18.9ms**, ~**358 rps** |

## Deploy path

1. `docs/deploy/f2-deploy-release.sh` (root on VPS)
2. Clone → `npm install` → `next build` → assemble `.next/standalone`
3. Symlink `/opt/9router-mw/current` → standalone
4. systemd unit + nginx site (SSL reuses gomerch cert until CF DNS ready)

## Notes

- First nginx smoke with bare `Host:` + IP returned unauthorized; correct smoke uses `--resolve router.budgezen.com:443:127.0.0.1`.
- DNS `router.budgezen.com` still blocked (Cloudflare user action) — see `docs/deploy/DNS-CLOUDFLARE-BLOCKER.md`.
- Single-process baseline only; multi-worker cluster.fork is Fase 3.

## Evidence files

See numbered `01-` … `13-` artifacts in this directory and `docs/bench/baseline-single-20260718.json`.
