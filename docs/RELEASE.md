# 9router-MW: Release Status

> **Status:** PRODUCTION FINAL
> **Product:** 9router-mw
> **Repo:** <https://github.com/fazulfi/9router-mw>
> **Current release:** v0.5.40-mw.0 (production live)
> **Hotfix candidate:** v0.5.40-mw.1 (pending, not yet tagged or deployed)

---

## What shipped

| Layer | Delivered |
| ----- | --------- |
| Multi-worker | 4 workers for concurrent capacity |
| Shared coordination | Distributed coordination for shared state |
| Persistence | Database as source of truth |
| Resilience | Production-grade resilience patterns |
| Load gate | Passed. Throughput improvement, zero errors, no double-request |
| Upstream integration | Selective sync from decolua/9router v0.5.40 |

**No double-request:** one client request reaches exactly one worker,
which makes exactly one upstream call. The cluster provides capacity,
not fan-out.

---

## Version map

| Artifact | Version |
| -------- | ------- |
| Upstream base | decolua/9router **0.5.40** (selective integration) |
| Current production release | **v0.5.40-mw.0** |
| Hotfix candidate (pending) | **v0.5.40-mw.1**, not yet tagged or deployed |
| Previous production release | **v0.5.35-mw.7** |

**v0.5.40-mw.0** integrates selected upstream v0.5.40 changes plus
MW-specific multi-worker patches. **v0.5.40-mw.1** is a candidate
hotfix pending review. It has not been tagged or deployed.

---

## Architecture overview

The product is a multi-worker fork of
[decolua/9router](https://github.com/decolua/9router). It runs:

- **4 workers** behind a single cluster primary
- **A shared coordination layer** for distributed state
- **A persistent database** as the source of truth

---

## Upstream integration

The fork tracks
[decolua/9router](https://github.com/decolua/9router). The v0.5.40
integration applied cherry-picks from upstream plus MW-specific
patches for multi-worker compatibility.

---

For public usage context, provider setup guides, and feature
documentation, see the [README](../README.md) and the upstream
repository.
