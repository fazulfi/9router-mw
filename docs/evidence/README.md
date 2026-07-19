# Evidence — 9router-mw

Machine-captured proofs per phase. Prefer raw command output over narrative.

**Final release status:** [`docs/RELEASE.md`](../RELEASE.md)  
**Git tag:** `v0.5.35-mw.7` · **Live app:** **`0.5.35-mw.7`**

## Layout

```text
docs/evidence/
  phase-00/   # bootstrap: remotes, tags, push — DONE
  phase-01/   # VPS prep — DONE
  phase-02/   # baseline deploy + k6 — DONE
  phase-03/   # multi-worker — DONE
  phase-04/   # Redis shared state — DONE
  phase-05/   # Vans resilience port — DONE
  phase-06/   # hot-path — DONE
  phase-07/   # load prove — DONE GREEN
  phase-08/   # production harden / public HTTPS go-live — DONE
  phase-09/   # operate + data migration finalize — DONE
  phase-10/   # formal deploy 0.5.35-mw.7 — DONE
```

## Naming

- `NN-short-slug.txt` or `.md` — e.g. `01-git-remotes.txt`
- Include command + exit code + timestamp when possible
- Redact secrets before commit

## Phase status matrix

| Phase | Status |
| ----- | ------ |
| 00–09 | **COMPLETE** |
| 10 | **COMPLETE** — formal live `0.5.35-mw.7` |
