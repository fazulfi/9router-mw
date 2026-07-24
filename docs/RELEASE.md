# 9router-MW: Release Status

> **Status:** PRODUCTION LOCKED
> **Product:** 9router-mw
> **Repo:** <https://github.com/fazulfi/9router-mw>
> **Current release:** v0.5.40-mw.23 (production live)
> **Deployed commit:** 722d712c8 (DB8 + coverage >80%)
> **Deployed at:** 2026-07-24T06:15:49Z (mw.22) — coverage + benchmark 2026-07-24

---

## What shipped

| Layer | Delivered |
| ----- | --------- |
| Multi-worker | 4 workers for concurrent capacity |
| Shared coordination | Redis-based distributed coordination |
| Persistence | better-sqlite3 with WAL, mmap 256MB, dedicated writer process |
| Resilience | Cluster auto-restart, writer crash recovery, connection draining |
| Writer isolation | All SQLite writes routed through dedicated child process |
| Zero-downtime deploy | Nginx upstream switch with blue-green slots (20131/20132) |
| Upstream integration | Selective sync from decolua/9router v0.5.40 |

**No double-request:** one client request reaches exactly one worker,
which makes exactly one upstream call. The cluster provides capacity,
not fan-out. Writes are queued via Redis and flushed by the dedicated
writer — workers never hold a write lock.

---

## Version map

| Artifact | Version |
| -------- | ------- |
| Upstream base | decolua/9router **0.5.40** (selective integration) |
| Current production release | **v0.5.40-mw.23** (722d712c8) |
| DB8 writer PR | **PR #6** feat(db): dedicated SQLite writer + deployment SOP |
| Test coverage lock | Iterasi 2/5 — 207 test files, 1926 tests, 0 failures |
| Benchmark | 303 req/s C100 (18K RPM), 4 workers, 4 vCPU |
| Previous production release | **v0.5.40-mw.22** (722d712c8) |

**v0.5.40-mw.23** is the current locked release. Production deployment is
unchanged from mw.22 (still commit 722d712c8 with DB8 writer architecture).
mw.23 locks the test suite at >80% coverage with verified benchmark results.

---

## Architecture overview

The product is a multi-worker fork of
[decolua/9router](https://github.com/decolua/9router). It runs:

- **Cluster primary** (`custom-server.js`) — forks workers, manages
  lifecycle, owns the dedicated SQLite writer process
- **4 workers** — handle all HTTP traffic; SQLite reads only, writes
  via Redis queue
- **Dedicated writer** (`primary-writer.mjs`) — drains Redis → batch
  insert → SQLite every ~2 seconds; handles PRAGMA, ANALYZE, VACUUM,
  backup, WAL checkpoint
- **Redis** — shared coordination (locks, pub/sub, usage buffer),
  circuit breaker state, rate-limit counters
- **SQLite** — better-sqlite3, WAL mode, mmap 256MB, journal_size_limit
  = 8MB, periodic checkpoint + ANALYZE + VACUUM

---

## Deployment SOP

Zero-downtime deployment via `docs/runtime-deployment/runtime-release.sh`:

```
./runtime-release.sh stage <ref>     # build + stage on isolated port 20130
./runtime-release.sh approve <id>    # verify staging smoke tests
./runtime-release.sh promote <id>    # Nginx upstream switch to candidate
./runtime-release.sh rollback        # revert to previous slot
./runtime-release.sh cleanup <id>    # stop staging + remove build artifacts
./runtime-release.sh status          # show current runtime state
```

## Upstream integration

The fork tracks
[decolua/9router](https://github.com/decolua/9router). The v0.5.40
integration applied cherry-picks from upstream plus MW-specific
patches for multi-worker and writer isolation.

See [CHANGELOG](../CHANGELOG.md) for full release history.
