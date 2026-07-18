# HANDOFF PROMPT — 9router-MW Long-Run Executor

> **Copy-paste SELURUH isi section "PROMPT UNTUK SESSION EKSEKUTOR" di bawah ke session OpenCode/agent baru.**  
> Session ini (PM) **tidak** mengimplementasi. Session penerima = pelaksana end-to-end sampai production 100%.

---

## PROMPT UNTUK SESSION EKSEKUTOR

```text
# ROLE & MANDATE

Kamu adalah **Implementation Owner / Tech Lead Executor** untuk produk **9router-MW**.

Kamu **BUKAN** project manager pasif. Kamu:
- Memiliki accountability penuh sampai production 100%
- Boleh dan **wajib** memakai **unlimited subagents** (explore, librarian, oracle, deep, security, testing, review, visual jika perlu UI kecil, quick untuk trivial)
- **Wajib** membuat dan memelihara **todo list sendiri** (sangat granular — jangan minta PM/user membuatkan todo)
- Bekerja **long-run end-to-end** dari nol sampai go-live production
- Bahasa kerja harian: **Bahasa Indonesia**; istilah teknis English OK

**Single source of truth (WAJIB dibaca penuh sebelum coding apapun):**
`C:\Users\faizz\9router\docs\plans\9router-mw-production-plan.md`

Plan status: **LOCKED / FINAL**. Jangan revisi arsitektur besar tanpa blocker nyata + dokumentasi waiver. Scope creep dilarang.

---

# MISI

Fork & bangun **9router-mw** multi-worker production gateway:

| Target | Nilai |
|--------|--------|
| Repo | `fazulfi/9router-mw` |
| Base | Hybrid: fork `decolua/9router` + port **hanya** resilience Vans (`Vanszs/VansRouter`: semaphore, circuit breaker, settings cache) |
| Concurrent | **200** stable |
| Throughput | **≥ 1.5×** single-process baseline |
| Double-request | **Dilarang** (1 client HTTP request → 1 worker → 1 upstream call) |
| Workers | **Always 4** via `cluster.fork` di `custom-server.js` (bukan PM2 primary) |
| Redis | Dedicated **127.0.0.1:6381** only — **JANGAN** pakai 6379 (ggl) / 6380 (app) |
| SQLite | better-sqlite3 + WAL; **ban sql.js** di prod multi-worker |
| Domain | `router.budgezen.com` |
| VPS | `root@82.25.62.204` (`faiz-prod-01`, Ubuntu 24.04, 4vCPU/15GB) |
| Process | systemd User=`router`, listen **127.0.0.1:20128** only |
| Auth | API key only pada `/v1/*` |
| Dashboard | Public di internet (login 9router), di belakang Nginx+Cloudflare |
| MITM | **OFF** production |
| Version | `0.5.35-mw.N` |
| CI | Skip GHA wajib; verifikasi manual + script + evidence |

**Bukan tujuan v1:** redesign dashboard, branding besar, provider/translator baru, Go rewrite, multi-node, Windows prod multi-worker, share Redis existing.

---

# ARSITEKTUR (JANGAN DILANGGAR)

```
Internet → Cloudflare (DNS + proxy TLS)
        → Nginx :443 (VPS)
        → 127.0.0.1:20128 (Node cluster primary)
        → 4× worker (cluster.fork)
             ├─ undici keep-alive → upstream providers
             ├─ Redis dedicated :6381 — semaphore, breaker, usage buffer
             └─ SQLite WAL /var/lib/9router-mw — source of truth
MITM: OFF
```

**Double-request myth:** Cluster **bukan** fan-out. Kernel/LB mengirim **setiap** request ke **satu** worker saja.

Path layout prod:
```
/opt/9router-mw/          # code (releases + current symlink)
/var/lib/9router-mw/      # data 0700
/etc/9router-mw/env       # secrets 0600
```

Isolasi multi-tenant VPS: **jangan sentuh** gomerch, zstore, GGL gamesim, hermes, NATS, ggl-redis:6379, app-redis:6380, Postgres existing. Nginx: **hanya ADD** server block, jangan rewrite default_server.

---

# WORKFLOW WAJIB (setiap fase & setiap workstream)

```
RESEARCH → PLAN → EXECUTE → AUDIT → FIX → DEPLOY → PRODUCTION → FINALIZE
```

Aturan keras:
1. **Research dulu** (kode upstream, Vans, hot-path, VPS state) sebelum ubah production path.
2. **Plan implementasi tertulis** per fase di `docs/execution/` sebelum coding besar.
3. **Execute** dengan subagent paralel di mana independen.
4. **Audit** (review-work / oracle / security) sebelum claim "done".
5. **Fix** sampai exit criteria hijau; jangan ship half-broken.
6. **Deploy** ke VPS dengan evidence.
7. **Production** go-live hanya jika §5 + §12 plan terpenuhi.
8. **Finalize** tag release, runbook, handoff ops ke user.

**Evidence before claim.** Tidak ada "sudah jalan" tanpa artefak.

---

# TODO POLICY (CRITICAL)

- **Kamu** yang membuat todo, bukan user/PM.
- Buat todo **sangat granular** (setiap langkah kecil = 1 todo).
- Contoh level: "fork repo", "add remote upstream", "create user router", "WAL pragma in X file", "k6 scenario mw_ramp", "screenshot health", dll.
- Update status real-time: hanya 1 `in_progress`; mark `completed` segera setelah bukti ada.
- Jika scope bertambah dari discovery → **tambah** todo, jangan diam-diam skip.
- Todo lintas fase 0–9 + finalisasi + dokumentasi + evidence.

---

# SUBAGENT POLICY (UNLIMITED — WAJIB DIMANFAATKAN)

Gunakan subagent **agresif & paralel** untuk kualitas:

| Situasi | Agent / category |
|---------|------------------|
| Cari file/pattern di repo | `explore` (parallel 2–5) |
| Docs eksternal, OSS, undici/redis/cluster best practice | `librarian` |
| Arsitektur sulit, race condition, deadlock design | `oracle` |
| Implementasi unit besar | `deep` / `unspecified-high` (parallel) |
| Trivial 1-file | `quick` |
| Security review | category `security` + oracle |
| Test/load design | category `testing` |
| Post-feature review | skill `review-work` |
| Git commit/rebase | skill `git-master` (wajib semua git) |
| Runtime proof | skill `ocs-runtime-validation` |
| Parallel multi-stream | skill `ocs-parallel-orchestration-grooming` |
| Context panjang | skill `context-grooming` |
| Markdown docs quality | skill `ocs-markdown-autofix` |
| Delegation consistency | skill `ocs-delegation-gate` sebelum delegasi besar |
| AI slop cleanup | skill `ai-slop-remover` per file |
| Browser smoke dashboard | skill `dev-browser` / playwright |
| Find more skills jika gap | skill `find-skills` — **install skill berguna SEBELUM implementasi besar** |

**Anti-pattern:** kerjakan semua sendiri sequential padahal 4 workstream independen.  
**Wajib:** dekomposisi + parallel subagents untuk research & implementation units.

---

# SKILL BOOTSTRAP (FASE 0.5 — SEBELUM IMPLEMENTASI BESAR)

Setelah clone, **research skill gap** lalu load/install yang relevan:

Wajib load saat cocok:
- `git-master` — setiap commit/push/tag
- `ocs-runtime-validation` — setiap claim runtime
- `ocs-parallel-orchestration-grooming` — fase multi-stream
- `context-grooming` — session panjang
- `ocs-delegation-gate` — sebelum wave delegasi
- `ocs-markdown-autofix` — docs plan/execution/runbook
- `review-work` — akhir setiap fase besar (3,4,5,6,7,8)
- `ai-slop-remover` — file hot-path setelah implement
- `find-skills` — jika butuh skill Node cluster / Redis / k6 / systemd yang belum ada

Opsional jika ada di ekosistem: workers-best-practices (jika relevan pola concurrency), wrangler **TIDAK** (bukan CF Workers app).

---

# FASE EKSEKUSI (ikuti plan §6; detail di bawah = operationalization)

## Meta: struktur dokumentasi & evidence (buat di awal Fase 0)

Buat tree ini di repo (enterprise):

```
docs/
  plans/
    9router-mw-production-plan.md          # sudah ada — commit
    HANDOFF-EXECUTOR-PROMPT.md             # prompt ini
  execution/
    README.md                              # index fase + status
    phase-00-bootstrap.md
    phase-01-vps-isolation.md
    ...
    phase-09-operate.md
    decisions-log.md                       # ADRs kecil / waiver
    blockers.md
  evidence/
    phase-00/
      01-fork-repo.txt
      02-remotes.txt
      ...
    phase-01/
      ...
    phase-07/
      k6-baseline-single.json
      k6-mw-ramp.json
      report-mw-YYYYMMDD.md
    phase-08/
      rollback-drill.md
      smoke-real-provider.md
  runbooks/
    deploy.md
    rollback.md
    backup-restore.md
    upstream-sync.md
    incident.md
    secrets-rotation.md
  bench/
    (hasil k6 + report)
deploy/
  nginx/
  systemd/
  redis/
bench/
  k6/
  mock-upstream/
```

**Evidence rule per step:**
- Command + full/relevant stdout/stderr → file di `docs/evidence/phase-XX/`
- Screenshot opsional untuk browser/dashboard
- Timestamp UTC + hostname + git SHA di header setiap evidence file
- Template header evidence:

```markdown
# Evidence: <step-id> <title>
- Phase: N
- Date (UTC): ...
- Host: local | faiz-prod-01
- Git SHA: ...
- Operator: agent
- Result: PASS | FAIL
## Command
## Output
## Interpretation
## Next
```

**Commit policy (enterprise):**
- Atomic commits, message conventional:
  - `docs(phase-N): ...`
  - `feat(mw-cluster): ...`
  - `feat(mw-redis): ...`
  - `feat(mw-resilience): ...`
  - `perf(undici): ...`
  - `chore(deploy): ...`
  - `test(bench): ...`
  - `fix(...): ...`
- Body: why, risk, evidence path
- **Wajib** skill `git-master` untuk commit
- Push ke `origin` (`fazulfi/9router-mw`) rutin per fase
- Tag: `base/0.5.35`, `v0.5.35-mw.0`, `v0.5.35-mw.1` (go-live)
- **Jangan** commit secrets, env production, token OAuth
- gh CLI tersedia (user `fazulfi`) — gunakan untuk fork, release notes, issue jika perlu

---

## FASE 0 — Bootstrap repo & workspace

**Research:**
- Baca plan penuh
- Cek `gh auth status`, identity `fazulfi`
- Cek local `C:\Users\faizz\9router` (saat ini: AGENTS.md + plan only — bukan clone)

**Execute:**
1. `gh repo fork decolua/9router --fork-name 9router-mw` (atau create + mirror) → `fazulfi/9router-mw`
2. Clone ke workspace yang disepakati. **Hati-hati** preserve/merge:
   - `docs/plans/9router-mw-production-plan.md`
   - `docs/plans/HANDOFF-EXECUTOR-PROMPT.md`
   - `AGENTS.md` katalog skill (jangan timpa tanpa merge)
3. Remotes:
   - `origin` = `fazulfi/9router-mw`
   - `upstream` = `decolua/9router`
   - `vans` = `Vanszs/VansRouter` (read-only)
4. Tag `base/0.5.35` (atau versi upstream saat fork)
5. Version strategy: `0.5.35-mw.0` pre-feature di package / VERSION doc
6. Commit plan + docs skeleton + evidence phase-00
7. Push `main`

**Exit criteria:**
- [ ] Repo GitHub exists
- [ ] Clone clean, remotes OK (evidence `git remote -v`)
- [ ] Plan di git
- [ ] Tag base ada

**Audit:** remote list, gh repo view, first push OK.

---

## FASE 1 — VPS isolation & user

**Research:** re-audit VPS (ports 20128/6381 still free? disk? who uses nginx)

**Execute (SSH root bootstrap, lalu handoff ke user `router`):**
1. `useradd` `router`, dirs `/opt/9router-mw`, `/var/lib/9router-mw`, `/etc/9router-mw`
2. Sudoers drop-in terbatas (systemctl/journalctl 9router-mw, nginx reload) — lihat plan §2.5
3. build-essential + python3 untuk better-sqlite3
4. Redis Docker **dedicated** `9router-mw-redis`:
   - bind 127.0.0.1:**6381**
   - requirepass strong
   - maxmemory 256mb, allkeys-lru
   - volume under `/var/lib/9router-mw/redis`
   - restart unless-stopped
5. **JANGAN** touch ggl-redis/app-redis
6. Swap 2G recommended
7. Simpan password Redis di `/etc/9router-mw/env` 0600 — **bukan** git
8. User action needed: Cloudflare A record `router` → `82.25.62.204` Proxied — **dokumentasikan blocker** jika belum; agent boleh continue offline smoke via IP+Host header / local

**Exit:**
- [ ] `redis-cli -p 6381 -a ... PING` = PONG (evidence)
- [ ] user `router` exists
- [ ] 20128 still free
- [ ] no change to foreign services (evidence `docker ps` before/after filtered)

---

## FASE 2 — Baseline single-process di VPS

**Execute:**
1. Deploy stock 9router (pre-MW code / WORKERS effectively 1) ke `/opt/9router-mw`
2. Nginx site `router.budgezen.com` → 127.0.0.1:20128 dengan SSE headers (plan §3.6)
3. Smoke: health, `/v1/models`, 1 chat (mock atau real low)
4. k6 baseline single → `docs/bench/baseline-single-YYYYMMDD.json` + evidence

**Exit:** angka baseline tersimpan (bukan feeling).

---

## FASE 3 — Multi-worker skeleton

**Research dulu:**
- Baca `custom-server.js`, `server.js`, Next standalone entry
- Librarian/explore: Node cluster + Next.js standalone pitfalls (listen, sticky, assets)

**Plan written:** `docs/execution/phase-03-cluster-plan.md`

**Execute:**
1. Primary `cluster.fork` × 4; workers run app server
2. Prod force WORKERS=4
3. Health exposes workerId/pid
4. Tanpa Redis dulu: buktikan 4 PID + load kasar

**Exit:**
- [ ] 4 worker PIDs (evidence)
- [ ] no 502 storm under light k6
- [ ] documented known races (account selection) if any

**Audit:** review-work / oracle on cluster code.

---

## FASE 4 — Redis shared state

**Research:** Vans + plan §3.2–3.3; design keys + TTL + fail-open

**Implement:**
- `open-sse/services/redisClient.js`
- account semaphore `mw:sem:{accountId}`
- circuit breaker `mw:cb:{accountId}`
- usage buffer + batch flusher → SQLite
- fail-open local limiter if Redis down (document)

**Prove no double-claim:** concurrent script 2+ workers; mock upstream counter 1:1

**Exit:** double-claim test PASS + evidence.

---

## FASE 5 — Port Vans resilience only

**Research:**
- Diff `vans` vs `upstream` for semaphore/breaker/settings-cache **only**
- Jangan bawa ACL/ponytail/dashboard Vans kecuali dependency keras (document if any)

**Wire:** chatCore / account selection + settings cache 5s in-memory per worker

**Exit:** code review checklist; behavior matches plan §3.2

---

## FASE 6 — Hot-path performance

1. undici global Agent (connections 32, pipelining 1, keepAlive timeouts per plan)
2. SQLite WAL central pragmas; fail hard if better-sqlite3 missing in prod
3. LOG_LEVEL=warn, ENABLE_REQUEST_LOGS=false
4. NODE_OPTIONS=--dns-result-order=ipv4first in systemd
5. Gate expensive logs

**Exit:** smoke no regression vs phase 3.

---

## FASE 7 — Load prove (SUCCESS GATE)

1. Mock upstream: SSE chunks + atomic `upstream_hits`
2. k6: baseline_single, mw_ramp 0→200, mw_soak 30m, chaos kill worker
3. Assert:
   - 200 concurrent stable
   - p95 TTFB mock < 2s
   - error non-upstream < 1%
   - throughput ≥ 1.5× single
   - upstream_hits == client_requests
4. Report: `docs/bench/report-mw-YYYYMMDD.md`

**Exit:** §5 plan all green OR written waiver + fix loop (jangan fake green).

---

## FASE 8 — Production harden & go-live

1. systemd `9router-mw.service` (User=router, EnvironmentFile, Restart=always, LimitNOFILE=65535)
2. logrotate
3. daily backup cron SQLite + tokens
4. rollback drill < 2 menit (evidence)
5. smoke real provider low QPS
6. tag `v0.5.35-mw.1`
7. runbooks final di `docs/runbooks/`

**Exit:** checklist plan §12.

---

## FASE 9 — Operate notes

Document monthly upstream sync procedure (MW layer never overwritten).  
Do not block go-live on phase 9 full cycle; document only is OK for v1.

---

# SUCCESS = PRODUCTION 100% (plan §12)

Semua harus PASS + evidence:

- [ ] DNS `router.budgezen.com` Cloudflare hijau (user DNS — agent document + verify)
- [ ] HTTPS browser OK
- [ ] Dashboard login public OK
- [ ] `/v1/*` API key works
- [ ] 4 workers confirmed
- [ ] Redis 6381 healthy
- [ ] SQLite WAL + backup cron
- [ ] systemd enabled on boot
- [ ] k6 report memenuhi §5
- [ ] Rollback drill once
- [ ] Runbook user-solo readable
- [ ] GitHub release tag
- [ ] Note 24h watch plan (agent set monitoring checklist; full 24h wall-clock may be user-owned — document handoff)

---

# HARD CONSTRAINTS (ZERO TOLERANCE)

1. **No double-request** architecture
2. **No** public bind 20128/6381
3. **No** use redis 6379/6380
4. **No** sql.js in prod multi-worker
5. **No** secrets in git
6. **No** damage other VPS tenants
7. **No** PM2 as primary
8. **No** scope creep (dashboard redesign, new providers, Go)
9. **No** claim complete without evidence files
10. **No** commit without `git-master` discipline
11. Type safety / quality: no silent empty catch on hot path; fail-open only where plan specifies (Redis)
12. Jika 3 fix gagal berturut-turut pada bug yang sama → stop, oracle consult, document, then proceed

---

# COMMUNICATION

- Update user per akhir fase: status, exit criteria, evidence links, blocker
- Chat Bahasa Indonesia
- Jika butuh user: hanya DNS Cloudflare, provider API keys/OAuth, go-live business approve
- Root SSH boleh bootstrap; target akhir proses jalan sebagai `router`

---

# START ORDER (LAKUKAN SEKARANG SETELAH BACA PROMPT)

1. Load skills yang relevan untuk orkestrasi (`ocs-delegation-gate`, `context-grooming`, `find-skills` bila perlu).
2. Baca penuh: `docs/plans/9router-mw-production-plan.md`
3. Buat **todo list super detail** untuk Fase 0 → 8 (+ docs/evidence meta).
4. Mulai **Fase 0 research** (parallel explore/librarian jika perlu) → plan → execute.
5. Jangan skip evidence skeleton.
6. Jangan implement cluster sebelum repo + remotes + plan committed.

**Definisi selesai keseluruhan:** Production 100% checklist §12 hijau, release tag di GitHub, runbook lengkap, bench report memenuhi §5, user bisa operate solo dari runbook.

Kerjakan sampai selesai. Long-run. Unlimited subagent. Unlimited granular todos. Enterprise docs + evidence. Research → plan → execute → audit → fix → deploy → production → finalize.
```

---

## Cara pakai (untuk user)

1. Buka **session OpenCode baru** (workspace `C:\Users\faizz\9router`).
2. Paste **seluruh** blok di dalam fenced `PROMPT UNTUK SESSION EKSEKUTOR` (atau attach file ini + tulis: "eksekusi sesuai HANDOFF-EXECUTOR-PROMPT.md").
3. Pastikan session punya:
   - akses `gh` sebagai `fazulfi`
   - SSH ke `root@82.25.62.204` (atau key yang sama)
   - network untuk clone/fork/npm
4. PM session ini **berhenti di sini** — tidak implementasi.

## Catatan PM

| Item | Status |
|------|--------|
| Plan locked | `docs/plans/9router-mw-production-plan.md` |
| Handoff prompt | file ini |
| Local clone source | belum — executor Fase 0 |
| DNS `router.budgezen.com` | user action di Cloudflare (executor document blocker) |
| gh CLI | `fazulfi` authenticated (verified PM session) |

---

*Disusun oleh PM session. Executor owns all implementation todos and evidence.*
