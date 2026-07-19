# Phase-09 Evidence — Operate + data migration finalize

**Tag:** `v0.5.35-mw.6`
**Date:** 2026-07-19
**Live app:** `0.5.35-mw.4`
**Public:** https://example.com

## Exit — MET

| Item | Result |
|------|--------|
| Public HTTPS health | 200, workers=4, redis ok, undici, wal |
| Provider connections (non-mimo) | **13727** on dest |
| Custom provider nodes | **3** |
| Proxy pools | **65** active |
| Combos | **8** |
| KV customModels / modelAliases | 48 / 56 |
| mimo excluded | **0** on dest |
| apiKeys | not migrated (0 on dest) |
| Foreign redis 6379/6380 | untouched |
| Final release doc | `docs/RELEASE.md` |

## Artifacts

| File | Purpose |
|------|---------|
| `01-provider-data-migration.md` | Full migration evidence connections + nodes/proxies/combos/kv |
| `02-final-health.txt` | Live health snapshot at finalize |
| `99-done.txt` | Phase close |

## Status

**Phase-09 COMPLETE** — production data + public edge finalized for release docs.
