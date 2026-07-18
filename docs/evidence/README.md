# Evidence — 9router-mw

Machine-captured proofs per phase. Prefer raw command output over narrative.

## Layout

```text
docs/evidence/
  phase-00/   # bootstrap: remotes, tags, push
  phase-01/   # VPS prep
  phase-02/   # baseline deploy + k6
  phase-03/   # multi-worker
  phase-04/   # Redis shared state
  phase-05/   # Vans resilience port
  phase-06/   # hot-path
  phase-07/   # load prove
  phase-08/   # production harden / go-live
  phase-09/   # operate
```

## Naming

- `NN-short-slug.txt` or `.md` — e.g. `01-git-remotes.txt`
- Include command + exit code + timestamp when possible
- Redact secrets before commit
