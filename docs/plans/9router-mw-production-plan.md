# 9router-MW — Production Plan (Final)

> **Status:** LOCKED — siap eksekusi long-run  
> **Produk:** `9router-mw`  
> **Repo target:** `fazulfi/9router-mw`  
> **Base upstream:** `decolua/9router` (+ cherry-pick resilience dari `Vanszs/VansRouter`)  
> **Dokumen ini:** single source of truth untuk arsitektur, fase, deploy, success criteria  
> **Bahasa kerja harian:** Indonesia | **Istilah teknis:** English OK  
> **Peran agent:** Owner / CEO / Project Manager 9router-MW (keputusan teknis final, eksekusi, accountability)

---

## 0. Ringkasan eksekutif

**Tujuan:** fork 9router menjadi gateway multi-worker production-grade yang stabil di **200 concurrent requests**, dengan RPM/throughput ≥ **1.5×** single-process, tanpa double-request ke upstream.

**Bukan tujuan v1:** redesign dashboard, branding, provider baru, rewrite Go, multi-node horizontal, Windows production multi-worker.

**Kunci arsitektur:**

```
Internet → Cloudflare (DNS + proxy TLS)
        → Nginx :443 (VPS)
        → 127.0.0.1:20128 (Node cluster primary)
        → 4× worker (cluster.fork)
             ├─ undici keep-alive → upstream providers
             ├─ Redis dedicated (127.0.0.1:6381)  — semaphore, breaker, usage buffer
             └─ SQLite WAL (/var/lib/9router-mw)  — source of truth
MITM: OFF di production
```

**Double-request?** **Tidak.** Cluster = 1 request HTTP → 1 worker saja. Bukan fan-out.

---

## 1. Keputusan terkunci (Decision Log)

| # | Topik | Keputusan final |
|---|--------|-----------------|
| D1 | Repo | `fazulfi/9router-mw` (public/private: private dulu, optional public later) |
| D2 | Base | Hybrid: fork `decolua/9router` + port Vans resilience only |
| D3 | Upstream sync | Remote `upstream` + rebase **monthly**; layer MW (cluster/redis/semaphore) **never** di-overwrite |
| D4 | Versioning | Track 9router + suffix: `0.5.35-mw.1` → `0.5.35-mw.N` |
| D5 | Workers | **Always 4** (`cluster.fork` di `custom-server.js`), bukan PM2 primary |
| D6 | Scope process | Entire Next server (gateway + dashboard) di cluster; MITM **off** prod |
| D7 | State hot | **Redis dedicated** instance 9router-mw (port **6381**, password) |
| D8 | State cold | **SQLite + better-sqlite3 + WAL** di `/var/lib/9router-mw` |
| D9 | Settings cache | In-memory **5s** per worker (Vans-style) |
| D10 | Vans v1 | Account semaphore + circuit breaker + settings cache |
| D11 | Auth `/v1/*` | **API key only** |
| D12 | Dashboard | **Public** di internet (login 9router), di belakang Nginx+Cloudflare |
| D13 | Domain | `router.budgezen.com` (A → VPS, Cloudflare Proxied) — **DNS record baru** |
| D14 | TLS | Cloudflare Full (origin cert self-signed/origin) **atau** LE di Nginx; pattern VPS sudah origin-cert style |
| D15 | Process manager | **systemd** unit (`9router-mw.service`) + auto-restart |
| D16 | Deploy model | Bare Node di VPS (bukan Docker app v1); Redis boleh Docker dedicated |
| D17 | Branch | Trunk-based: `main` + short feature branches |
| D18 | CI v1 | **Skip** GitHub Actions load/lint wajib; verifikasi manual + script lokal/VPS |
| D19 | Load tool | `k6` (primary), mock upstream untuk isolasi gateway |
| D20 | Success | Stable @ 200 concurrent; p95 TTFB **< 2s** (gateway-side mock); error non-upstream **< 1%**; throughput **≥ 1.5×** single-process; soak **30 menit** |
| D21 | Observability v1 | Health endpoint + journald + file log; **reuse** Grafana/Prometheus GGL yang sudah ada (scrape opsional v1.1) |
| D22 | Logging prod | `LOG_LEVEL=warn`; `ENABLE_REQUEST_LOGS=false`; body log **off** |
| D23 | Secrets | File env `/etc/9router-mw/env` (0600) + data dir 0700; **bukan** commit ke git |
| D24 | OS user | Dedicated user `router` (nopasswd sudo terbatas) — setup di fase bootstrap VPS |
| D25 | Bahasa plan | Bilingual sections di doc ini; chat kerja **Bahasa Indonesia** |
| D26 | Branding | Internal name **9router-mw** (UI title boleh tetap 9router + badge MW) |

---

## 2. Inventory VPS (hasil audit live)

**Host:** `faiz-prod-01`  
**SSH:** `root@82.25.62.204`  
**Public IP:** `82.25.62.204`  
**OS:** Ubuntu 24.04 LTS (Noble), kernel 6.8.0-31-generic  
**CPU:** 4 vCPU  
**RAM:** 15 GiB (saat audit ~2.3 GiB used, ~12–13 GiB available)  
**Disk:** 99G ext4, ~11G used, ~83G free (12%)  
**Swap:** **0** (catatan: tambah swap 2–4G di fase harden)

### 2.1 Stack yang sudah jalan (JANGAN diganggu)

| Komponen | Detail | Isolasi |
|----------|--------|---------|
| Nginx | 1.24, :80/:443 public | Shared edge — kita **tambah** server block, tidak rewrite default gomerch |
| Docker | 29.6.1 | Banyak stack GGL + app |
| Node | v20.20.2 / npm 10.8.2 | Global OK untuk build 9router-mw |
| Tailscale | `tailscaled`, IP `100.100.17.99` | Ops access |
| fail2ban | active | Keep |
| UFW | 22/80/443 + tailscale | Keep; **jangan** buka 20128 ke public |

**Services app lain (coexist):**

- `gomerch` → Nginx default_server → `127.0.0.1:3015`
- `zstore` / `mypapyr.com` webhooks
- Guinevere Game Lab stack (gamesim-*, hermes, NATS paper)
- CSA paper (`csa-api`, `csa-worker`, nats-paper)
- GGL observability Docker: Grafana `:3000`, Prometheus `:9090`, Loki `:3100`, Alertmanager `:9093`
- Redis existing:
  - `ggl-redis` → `127.0.0.1:6379` (**NOAUTH required** — **JANGAN pakai**)
  - `app-redis-1` → `127.0.0.1:6380` (PONG, milik app lain — **JANGAN pakai**)
- Postgres various: host `5432`, docker `5433`, `5440`, pgbouncer `6432`

### 2.2 Port plan 9router-mw (FREE saat audit)

| Port | Bind | Fungsi |
|------|------|--------|
| **20128** | `127.0.0.1` only | Node cluster listen (Nginx reverse-proxy) |
| **6381** | `127.0.0.1` only | Redis **dedicated** 9router-mw |
| 443/80 | public | Nginx (existing) + new server_name |

**Rule:** app listen localhost only. Public hanya lewat Nginx + Cloudflare.

### 2.3 DNS (Cloudflare `budgezen.com`)

Sudah ada (screenshot): `api`, `api-staging`, `budgezen.com`, `staging`, `status`, `www`, mail records.  
**Belum ada:** `router.budgezen.com`.

**Action required (user, 1× di Cloudflare):**

| Name | Type | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| `router` | A | `82.25.62.204` | **Proxied** (orange) | Auto |

Opsional later: `router-staging` → same IP, DNS-only untuk smoke internal.

### 2.4 Path layout production

```
/opt/9router-mw/                 # app code (git clone, owned router:router)
  current -> releases/0.5.35-mw.N
  releases/
  shared/                        # optional shared assets
/var/lib/9router-mw/             # DATA — SQLite, tokens, usage (0700)
  db/
  tokens/
  logs/                          # if file logs enabled
  backups/
/etc/9router-mw/
  env                            # secrets + config (0600, root:router)
/etc/systemd/system/
  9router-mw.service
  9router-mw-redis.service       # if not docker; OR docker compose unit
/var/log/9router-mw/             # optional rotated logs
```

### 2.5 OS user `router` (independen, nopasswd terbatas)

```text
useradd -r -m -d /home/router -s /bin/bash router
# group docker HANYA jika Redis via docker sock dibutuhkan — prefer tidak
# sudoers drop-in: /etc/sudoers.d/9router-mw
router ALL=(root) NOPASSWD: /bin/systemctl start 9router-mw, /bin/systemctl stop 9router-mw, /bin/systemctl restart 9router-mw, /bin/systemctl status 9router-mw, /bin/systemctl reload nginx, /bin/journalctl -u 9router-mw *
```

Deploy SSH: key-based ke `router@82.25.62.204` (atau tetap root untuk bootstrap lalu handoff).

---

## 3. Arsitektur konsep

### 3.1 High-level

```
                    ┌──────────────── Cloudflare ────────────────┐
 Clients            │ DNS router.budgezen.com → 82.25.62.204     │
 (API key)          │ TLS edge + DDoS + cache (API cache OFF)     │
        │           └───────────────────┬────────────────────────┘
        │ HTTPS                         │
        ▼                               ▼
                 ┌────────── Nginx :443 ──────────┐
                 │ server_name router.budgezen.com│
                 │ proxy → 127.0.0.1:20128        │
                 │ SSE headers, timeouts long     │
                 └───────────────┬────────────────┘
                                 │
                 ┌───────────────▼────────────────┐
                 │  Node primary (cluster master) │
                 │  listens 127.0.0.1:20128       │
                 │  fork × 4 workers              │
                 └─┬──────┬──────┬──────┬─────────┘
                   │      │      │      │
                W0     W1     W2     W3
                 │      │      │      │
     undici pool │      │      │      │  keep-alive ke providers
                 │      │      │      │
                 └──────┴──┬───┴──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        Redis :6381   SQLite WAL   Upstream APIs
        (hot state)   (source of    (OpenAI-compat,
         semaphore     truth:        Anthropic, dll)
         breaker       accounts,
         usage buf     settings,
                       history)
```

### 3.2 Request lifecycle (1 request = 1 worker)

1. Client → Cloudflare → Nginx → **satu** worker (kernel round-robin / cluster distribution).
2. Worker: auth API key → parse body → combo/account select.
3. **Semaphore (Redis):** claim slot account (atomic INCR/DECR + TTL); jika penuh → pilih account lain / 429 controlled.
4. **Circuit breaker (Redis):** skip account OPEN; half-open probe; close on success.
5. Settings: read memory cache (≤5s) else SQLite.
6. Translate + optional RTK (fail-open) → `executor.execute()` via **undici Agent** keep-alive.
7. Stream SSE ke client (Nginx: `proxy_buffering off`).
8. Usage event → Redis buffer → async flush → SQLite (bukan sync write per token).
9. Release semaphore.

**Tidak ada** step “broadcast ke semua worker”.

### 3.3 Kenapa Redis dedicated (6381), bukan ggl-redis / app-redis

| Redis | Port | Alasan tolak / terima |
|-------|------|------------------------|
| ggl-redis | 6379 | Auth required, milik GGL observability — **risk key collision & blast radius** |
| app-redis-1 | 6380 | Milik app lain — **jangan share** |
| **9router-mw-redis** | **6381** | Isolated DB index, password sendiri, maxmemory policy sendiri |

Config Redis MW (rekomendasi):

- `maxmemory 256mb`
- `maxmemory-policy allkeys-lru` (hot cache OK hilang; SQLite tetap truth)
- `requirepass` random 32+ chars
- bind `127.0.0.1`
- persistence: **RDB snapshot 15m** cukup (bukan AOF wajib); data kritis di SQLite

### 3.4 SQLite multi-worker

- Driver: **better-sqlite3 only** di prod; jika load gagal → process **exit 1** (ban sql.js multi-worker).
- Pragma: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`.
- 1 file DB; multiple readers OK; writers serialized by SQLite + busy_timeout.
- Heavy counters → Redis; SQLite untuk durable rows.

### 3.5 undici pool

Global `Agent` (atau per-origin):

- `connections: 32` (tunable)
- `pipelining: 1` (aman dulu; naikkan setelah bukti)
- `keepAliveTimeout: 30_000`
- `keepAliveMaxTimeout: 60_000`
- DNS: `--dns-result-order=ipv4first` di systemd `ExecStart`

### 3.6 Nginx SSE requirements

```nginx
# inti (detail di fase deploy)
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

Cloudflare: untuk path `/v1/*` pastikan **tidak** di-cache; WebSockets/SSE timeout CF ~100s default pada free — **catatan risiko**: long SSE mungkin putus di edge CF. Mitigasi v1:

- Prefer client reconnect / chunk keep-alive comments;
- Atau DNS-only (grey cloud) untuk `router` jika SSE panjang kritis (keputusan go-live).

### 3.7 Failure modes & mitigasi

| Failure | Gejala | Mitigasi |
|---------|--------|----------|
| Worker crash | 502 singkat | cluster auto-fork; systemd Restart=always |
| Redis down | semaphore fail | **fail-open local** limiter per-worker (degraded) + alert; jangan hang request |
| SQLite locked | write error | busy_timeout + queue usage; alert if >N errors/min |
| Upstream 429/5xx | client error | breaker + account failover (existing 9router + Vans) |
| Disk full | write fail | monitor disk; logrotate; prune usage |
| OOM | kill worker | 4 workers @ 15GB OK; cap undici; max body size |
| Double-spend token | rare race | Redis semaphore atomic; never dual claim without key |

### 3.8 Secrets recommendation (D23)

**Pilih:** env file + restricted FS (cocok VPS multi-tenant, tidak ganggu stack lain).

```
/etc/9router-mw/env          # ROOT:router 0640 or 0600
  PORT=20128
  HOST=127.0.0.1
  WORKERS=4
  DATA_DIR=/var/lib/9router-mw
  REDIS_URL=redis://:PASSWORD@127.0.0.1:6381/0
  LOG_LEVEL=warn
  ENABLE_REQUEST_LOGS=false
  NODE_OPTIONS=--dns-result-order=ipv4first
  # + 9router existing vars
```

OAuth tokens provider: tetap di `DATA_DIR` (model 9router), permission 0700 `router:router`.  
**Jangan** taruh di repo, **jangan** di world-readable home root.

Backup secrets: copy encrypted off-box (user policy); v1 cukup `tar` data dir harian lokal `/var/lib/9router-mw/backups`.

---

## 4. Scope fitur

### 4.1 v1 MUST SHIP

- [x] Fork + remotes (`origin`, `upstream`, optional `vans`)
- [x] `cluster.fork` always 4 workers di custom-server
- [x] Redis dedicated + client wrapper (connect, retry, health)
- [x] Account semaphore (Redis)
- [x] Circuit breaker (Redis)
- [x] Settings cache 5s in-memory
- [x] undici keep-alive Agent pada hot path
- [x] better-sqlite3 + WAL harden; fail hard tanpa native
- [x] IPv4-first DNS
- [x] Prod log defaults (warn, no request body)
- [x] Health endpoint (liveness + optional readiness: redis/sqlite)
- [x] systemd unit + Nginx site + Cloudflare DNS doc
- [x] User `router` nopasswd terbatas
- [x] k6 scripts: baseline single vs multi @ 200 concurrent
- [x] Mock upstream untuk load test isolasi
- [x] Runbook: deploy, rollback, upstream sync, backup
- [x] MITM **off** production

### 4.2 v1 MUST NOT

- Dashboard redesign / rebrand besar
- Provider / translator baru
- Go rewrite
- PM2 sebagai primary process manager
- sql.js di production multi-worker
- Share Redis GGL/app
- Buka port 20128/6381 ke public
- Windows multi-worker production
- CI load test wajib

### 4.3 v1.1+ backlog

1. Parallel `/v1/models` catalog fetch  
2. Prometheus metrics scrape (reuse ggl-prometheus)  
3. Docker image optional  
4. DNS-only mode guide untuk SSE panjang  
5. Multi-node (sticky + Redis already shared)  
6. Windows local multi-worker experimental  

---

## 5. Success criteria (acceptance)

| Metric | Target | Cara ukur |
|--------|--------|-----------|
| Concurrent | 200 virtual users | k6 |
| Throughput | ≥ 1.5× single-process baseline | k6 req/s atau SSE starts/s |
| p95 TTFB (mock upstream) | < 2s | k6 |
| Error rate (non-upstream) | < 1% | k6 + app logs |
| Soak | 30 menit @ 100–200 VU tanpa memory climb tak terbatas | k6 + `ps`/prometheus node |
| Restart recovery | worker mati → diganti < 5s; full service restart < 30s | chaos kill |
| No double upstream | 1 client request → 1 upstream call (mock counter) | mock metrics |
| Data safety | credentials survive restart | smoke checklist |

**Go-live gate:** semua baris hijau pada mock + smoke real 1 provider (low QPS).

---

## 6. Fase eksekusi long-run

> Prinsip: **evidence before claim**. Setiap fase punya exit criteria.  
> Agent = Owner/PM: urutan boleh digeser jika blocker, scope v1 tidak melar.

### Fase 0 — Bootstrap repo & workspace (hari 0)

**Langkah:**

1. GitHub: create `fazulfi/9router-mw` (fork UI atau `gh repo fork decolua/9router --fork-name 9router-mw`).
2. Local: clone ke `C:\Users\faizz\9router` (replace/merge AGENTS.md carefully).
3. Remotes:
   - `origin` → `fazulfi/9router-mw`
   - `upstream` → `decolua/9router`
   - `vans` → `Vanszs/VansRouter` (read-only reference)
4. Branch `main` track origin; tag `base/0.5.35` (atau version upstream saat fork).
5. Commit dokumen plan ini ke `docs/plans/9router-mw-production-plan.md`.
6. Catat baseline version di `VERSION` / package.json strategy (`0.5.35-mw.0` pre-feature).

**Exit:** repo cloneable, remotes OK, plan di git.

### Fase 1 — VPS isolation & user (hari 0–1)

**Langkah:**

1. Create user `router`, dirs `/opt/9router-mw`, `/var/lib/9router-mw`, `/etc/9router-mw`.
2. Sudoers drop-in (systemctl/journalctl terbatas).
3. SSH key untuk `router` (opsional).
4. Install build deps better-sqlite3 (`build-essential`, `python3`).
5. **Dedicated Redis** container `9router-mw-redis` port **6381**, password, restart unless-stopped, volume `/var/lib/9router-mw/redis`.
6. **Jangan** sentuh ggl-redis / app-redis / gamesim / zstore / gomerch configs kecuali Nginx **add** site.
7. Add swap 2G (opsional tapi recommended).
8. Cloudflare: user buat record `router` A → `82.25.62.204` Proxied.

**Exit:** `redis-cli -p 6381 -a ... PING` = PONG; user `router` exists; ports still free for 20128.

### Fase 2 — Baseline single-process di VPS (hari 1)

**Langkah:**

1. Deploy stock 9router (pre-MW) as single process di `/opt/9router-mw` listen 127.0.0.1:20128.
2. Nginx site `router.budgezen.com` → 20128 (SSE headers).
3. Smoke: health + `/v1/models` + 1 chat.
4. k6 baseline **single-process** → simpan `docs/bench/baseline-single-YYYYMMDD.json`.

**Exit:** angka baseline tersimpan (bukan feeling).

### Fase 3 — Multi-worker skeleton (hari 1–2)

**Langkah:**

1. Ubah `custom-server.js` / entry: primary fork 4 workers; workers run Next/server.
2. Env `WORKERS=4` forced (ignore 1 in prod unit).
3. Health: include `workerId` / pid.
4. Sticky session: **tidak** perlu untuk stateless API key (default cluster OK).
5. Tanpa Redis dulu: buktikan 4 proses hidup, load merata kasar.

**Exit:** 4 worker PID; k6 smoke tidak 502 storm; **masih** boleh race di account selection (dicatat).

### Fase 4 — Redis shared state (hari 2–3)

**Langkah:**

1. Module `open-sse/services/redisClient.js` (connect URL from env).
2. Account semaphore keys: `mw:sem:{accountId}` dengan TTL safety.
3. Circuit breaker keys: `mw:cb:{accountId}` state OPEN/HALF/CLOSED + counters.
4. Usage buffer list/stream + flusher interval (batch SQLite).
5. Fail-open policy jika Redis timeout (document).
6. Unit test / script manual concurrent claim.

**Exit:** 2 worker tidak double-claim account di test script; mock proves 1:1 upstream.

### Fase 5 — Port Vans resilience (hari 3–4)

**Langkah:**

1. Diff `Vanszs/VansRouter` vs upstream: ambil **hanya** semaphore/breaker/settings-cache patterns.
2. Wire ke `chatCore` / account selection path.
3. Settings cache 5s per worker.
4. Jangan bawa ACL/ponytail/dashboard Vans kecuali perlu.

**Exit:** code review checklist; behavior match design §3.2.

### Fase 6 — Hot-path performance (hari 4–5)

**Langkah:**

1. undici `Agent` global di `proxyFetch` / base executor.
2. SQLite WAL pragma central.
3. Fail hard if better-sqlite3 missing in prod (`NODE_ENV=production` + `MW_REQUIRE_NATIVE_SQLITE=1`).
4. Log defaults prod.
5. `NODE_OPTIONS=--dns-result-order=ipv4first`.
6. Disable/gate expensive request logs.

**Exit:** microbench optional; no regression vs Fase 3 smoke.

### Fase 7 — Load prove (hari 5–6)

**Langkah:**

1. Mock upstream (fast fixed latency + counter).
2. k6: ramp 0→200 VU; hold; measure TTFB p95, error%, throughput.
3. Compare multi vs baseline single (Fase 2).
4. Soak 30m @ 100–200 VU.
5. Chaos: `kill -9` one worker mid-load.
6. Write `docs/bench/report-mw-YYYYMMDD.md`.

**Exit:** semua Success Criteria §5 hijau **atau** documented waiver + fix loop.

### Fase 8 — Production harden & go-live (hari 6–7)

**Langkah:**

1. systemd `9router-mw.service` (User=router, EnvironmentFile, Restart=always, LimitNOFILE=65535).
2. logrotate.
3. Backup cron: daily tar SQLite → `/var/lib/9router-mw/backups` (retain 7d).
4. Rollback drill: deploy N, rollback N-1, <2 menit.
5. Smoke real provider low QPS.
6. Tag release `v0.5.35-mw.1`.
7. Runbook final di `docs/runbooks/`.

**Exit:** production traffic boleh; monitoring manual 24–48j.

### Fase 9 — Operate & upstream sync (ongoing)

**Langkah bulanan:**

1. `git fetch upstream && git rebase upstream/main` (or merge) on branch `sync/YYYY-MM`.
2. Resolve conflicts: **MW files win** on cluster/redis/semaphore.
3. Re-run k6 smoke subset.
4. Tag `0.x.y-mw.N`.

---

## 7. Deploy & operasi

### 7.1 systemd (sketsa)

```ini
[Unit]
Description=9router-MW multi-worker gateway
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=router
Group=router
WorkingDirectory=/opt/9router-mw/current
EnvironmentFile=/etc/9router-mw/env
ExecStart=/usr/bin/node custom-server.js
Restart=always
RestartSec=3
LimitNOFILE=65535
# MemoryMax= optional later

[Install]
WantedBy=multi-user.target
```

### 7.2 Nginx site (sketsa)

- `server_name router.budgezen.com;`
- SSL: Cloudflare origin cert (pattern existing `/etc/nginx/ssl/`) **atau** LE
- `proxy_pass http://127.0.0.1:20128;`
- SSE settings §3.6
- **Jangan** set `default_server` (gomerch sudah pegang)

### 7.3 Rollback

1. `systemctl stop 9router-mw`
2. `ln -sfn /opt/9router-mw/releases/<prev> /opt/9router-mw/current`
3. `systemctl start 9router-mw`
4. Smoke health

Target downtime: **< 30s** (connection drain best-effort).

### 7.4 Backup

```bash
# daily
sqlite3 /var/lib/9router-mw/db/main.sqlite ".backup '/var/lib/9router-mw/backups/main-$(date +%F).sqlite'"
# + tar tokens dir
```

### 7.5 Observability v1

- `journalctl -u 9router-mw -f`
- `GET /api/health` (or existing 9router health path) — extend with redis/sqlite/workers
- Optional v1.1: export metrics ke existing Prometheus `127.0.0.1:9090`

**Log level:** `warn` default; naikkan `info` sementara saat insiden.

---

## 8. Load test design

### 8.1 Mock upstream

Local tiny server (atau worker-internal mode):

- `POST /v1/chat/completions` → SSE 10 chunks @ 20ms
- Counter atomic `upstream_hits`
- Client request id header echoed

Assert: `upstream_hits == client_requests` (no double).

### 8.2 k6 scenarios

1. **baseline_single** — WORKERS effectively 1 (or pre-MW build)
2. **mw_ramp** — 0→200 in 2m, hold 5m
3. **mw_soak** — 150 VU × 30m
4. **mw_chaos** — mid-test worker kill (manual)

Thresholds di script = §5.

### 8.3 Real provider (secondary)

Hanya smoke: 5 VU × 2m, 1 model murah; **bukan** gate throughput (rate limit noise).

---

## 9. Keamanan

| Kontrol | Implementasi |
|---------|--------------|
| Auth API | API key 9router |
| Network | App localhost; UFW 80/443 only public |
| Redis | password + bind 127.0.0.1 |
| FS | 0700 data, 0600 env |
| Process | non-root `router` |
| TLS | Cloudflare + origin SSL |
| Dashboard public | login 9router; rate limit via CF later if abuse |
| Secrets rotation | ganti REDIS pass + API keys runbook |
| MITM | disabled prod |

---

## 10. Risiko & asumsi

| Risiko | Level | Mitigasi |
|--------|-------|----------|
| Cloudflare SSE timeout | Medium | keep-alive comments; option grey-cloud |
| 4 workers on shared 4 vCPU VPS + other apps | Medium | nice/cpu quota later; monitor load |
| SQLite writer bottleneck | Medium | Redis buffer; batch flush |
| Redis fail → thundering herd | Medium | fail-open local + breaker default conservative |
| Upstream rebase conflicts | Medium | thin MW layer, monthly discipline |
| Shared VPS noisy neighbor | Low–Med | cgroup optional later |
| No swap | Low | add 2G swap Fase 1 |
| Root SSH masih dipakai bootstrap | Med | handoff ke `router` + key |

**Asumsi:** Node 20 cukup (upstream mungkin target 22 — uji; upgrade Node 22 LTS jika build butuh).

---

## 11. RACI singkat

| Aktivitas | Agent (Owner/PM) | User (Owner infrastruktur) |
|-----------|------------------|----------------------------|
| Keputusan teknis MW | **A/R** | C |
| Coding / PR / deploy commands | **R** | I |
| Cloudflare DNS record | C | **R** |
| VPS root akses | **R** (diberi) | A |
| Provider API keys / OAuth login | C | **R** |
| Go-live business approve | C | **A** |
| Budget VPS | I | **A** |

R=Responsible, A=Accountable, C=Consulted, I=Informed

---

## 12. Definisi “production 100%”

Checklist final:

- [ ] DNS `router.budgezen.com` → hijau Cloudflare
- [ ] HTTPS valid di browser
- [ ] Dashboard login OK public
- [ ] `/v1/*` API key works
- [ ] 4 workers confirmed
- [ ] Redis 6381 healthy
- [ ] SQLite WAL file exists, backup cron OK
- [ ] systemd enabled on boot
- [ ] k6 report memenuhi §5
- [ ] Rollback drill done once
- [ ] Runbook readable by user solo
- [ ] Tag release di GitHub
- [ ] 24h tanpa crash loop

---

## 13. Urutan file yang akan disentuh (preview implementasi — belum dikerjakan)

| Area | File (perkiraan upstream) |
|------|---------------------------|
| Cluster entry | `custom-server.js`, `server.js` |
| HTTP pool | `open-sse/utils/proxyFetch.js`, `open-sse/executors/base.js` |
| Redis | **new** `open-sse/services/redisClient.js`, `accountSemaphore.js`, `circuitBreaker.js` |
| Chat wire | `open-sse/handlers/chatCore.js`, `src/sse/handlers/chat.js` |
| DB | `src/lib/db/*` pragma + native require |
| Health | existing health route + extend |
| Deploy | `deploy/nginx/router.budgezen.com.conf`, `deploy/systemd/9router-mw.service`, `deploy/redis/docker-compose.yml` |
| Bench | `bench/k6/*.js`, `bench/mock-upstream/*` |
| Docs | `docs/plans/*`, `docs/runbooks/*`, `docs/bench/*` |

---

## 14. Komunikasi & cara kerja

- Chat: **Bahasa Indonesia**
- Agent role: **Owner + CEO + PM** — prioritaskan, potong scope creep, minta bukti, blokir merge yang merusak multi-tenant VPS
- Setiap fase: update singkat status + exit criteria met/not
- Implementasi **belum mulai** sampai user bilang **“mulai eksekusi”** / **“jalankan fase 0”**

---

## 15. Lampiran — jawaban user dipetakan

| Q | User | Keputusan di plan |
|---|------|-------------------|
| 1 VPS | SSH root@82.25.62.204, audit sendiri, user independen nopasswd | §2 inventory + user `router` |
| 2 Domain | Screenshot Cloudflare budgezen.com | `router.budgezen.com` baru |
| 3 Redis | Same VPS | Dedicated :6381 |
| 4 Path | Cek sendiri | `/var/lib/9router-mw`, `/opt/9router-mw` |
| 5 Auth | API key only | D11 |
| 6 Dashboard | Public | D12 |
| 7 Secrets | Saran agent, jangan ganggu prod | env file + 0700 data |
| 8 MITM | Off prod | D6 |
| 9–10 Log/metrics | Rekomendasi agent | warn + journald; Grafana later |
| 11 Process | Better? | systemd |
| 12 Rollback | Better? | release symlink + git tag |
| 13–15 Load | Bebas / iya | k6 + mock + targets §5 |
| 16 Branch | Trunk | D17 |
| 17 CI | Skip | D18 |
| 18 Upstream | Bebas saran | monthly + protect MW |
| 19 Version | 9router + suffix | D4 |
| 20–22 Scope | Iya | §4 |
| 23 Phase | Agent atur | §6 |
| 24 Akses | Diberi | root SSH dipakai bootstrap |
| 25 Bahasa | ID percakapan | §14 |
| 26 Name | 9router-mw | D26 |
| Role | Owner/CEO/PM | header + §11 |

---

## 16. Next action (menunggu perintah)

Dokumen ini **FINAL untuk eksekusi**. Tidak butuh revisi besar kecuali:

- Domain bukan `router.budgezen.com` (ganti 1 baris DNS)
- Redis port bentrok (audit ulang saat eksekusi)

**Untuk mulai long-run, balas salah satu:**

1. `mulai fase 0` — fork/clone/remotes + commit plan  
2. `mulai fase 0–1` — sekalian bootstrap VPS user+redis  
3. `revisi: <poin>` — hanya jika ada koreksi eksplisit  

---

*Dokumen disiapkan sebagai Owner/PM 9router-MW. Evidence VPS: audit SSH 2026-07-19 pada `faiz-prod-01` / `82.25.62.204`.*
