#!/usr/bin/env bash
# Staging smoke test for 9router-MW v0.5.40-mw.0
# Runs against staging on 127.0.0.1:20129 with Redis 6382.
# Verifies: health gate, container up, no double-claim, optional k6.
# Does NOT touch production.
set -uo pipefail

APP_PORT="${APP_PORT:-20129}"
REDIS_PORT="${REDIS_PORT:-6382}"
REDIS_CONTAINER="${REDIS_CONTAINER:-9router-mw-redis-staging}"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/9router-mw-staging-v0.5.40-evidence}"
RELEASE_DIR="${RELEASE_DIR:-/opt/9router-mw-staging/releases/0.5.40-mw.0}"

mkdir -p "$EVIDENCE_DIR"
echo "=== Staging smoke v0.5.40-mw.0 ===" | tee "$EVIDENCE_DIR/06-staging-smoke.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"

# --- 1) container / socket up ---
echo "--- container + socket ---" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
docker ps --filter "name=${REDIS_CONTAINER}" --format '{{.Names}} {{.Status}}' | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
ss -tlnp | grep "${APP_PORT}" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt" || true

# --- 2) health gate: 5 rapid calls ---
echo "--- health samples (5 rapid) ---" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
: > "$EVIDENCE_DIR/03-staging-health.json"
: > "$EVIDENCE_DIR/03-staging-health-raw.txt"
for i in $(seq 1 5); do
  RESP=$(curl -sS -m 5 "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || echo '{"error":"curl-failed"}')
  echo "${RESP}" >> "$EVIDENCE_DIR/03-staging-health-raw.txt"
  # extract JSON only (skip curl-failed lines)
  if echo "${RESP}" | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
    echo "${RESP}" >> "$EVIDENCE_DIR/03-staging-health.json"
  fi
  echo >> "$EVIDENCE_DIR/03-staging-health-raw.txt"
done

# --- 3) analysis ---
python3 - <<'PY' | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
import json, collections
try:
    text=open("/tmp/9router-mw-staging-v0.5.40-evidence/03-staging-health-raw.txt").read()
except Exception as e:
    print("HEALTH_READ_FAIL", e); raise SystemExit(0)
ids=[]; redis_ok=0; undici_ok=0; sqlite_drivers=collections.Counter()
journal_modes=collections.Counter(); versions=set(); http_200=0
for line in text.splitlines():
    line=line.strip()
    if not line: continue
    try:
        o=json.loads(line)
    except Exception:
        continue
    ids.append(o.get("workerId"))
    r=o.get("redis") or {}
    if r.get("ok"): redis_ok += 1
    hp=o.get("hotpath") or {}
    und=hp.get("undici") or {}
    if und.get("enabled"): undici_ok += 1
    sq=hp.get("sqlite") or {}
    if sq.get("driver"): sqlite_drivers[sq.get("driver")] += 1
    if sq.get("journalMode"): journal_modes[str(sq.get("journalMode")).lower()] += 1
    if o.get("version"): versions.add(o.get("version"))
    if o.get("ok") is True: http_200 += 1
c=collections.Counter(ids)
print("samples", len(ids))
print("ok_count", http_200)
print("unique_workerIds", sorted(c.keys(), key=lambda x: (x is None, str(x))))
print("counts", dict(c))
print("redis_ok_count", redis_ok)
print("undici_ok_count", undici_ok)
print("sqlite_drivers", dict(sqlite_drivers))
print("journal_modes", dict(journal_modes))
print("versions", sorted(versions))
print("PASS_MULTI" if len(c)>=2 else "WARN_FEW_WORKERS")
print("PASS_FOUR" if len(c)>=4 else "WARN_NOT_FOUR")
print("PASS_REDIS" if redis_ok == len(ids) and len(ids) > 0 else "WARN_REDIS_DEGRADED")
print("PASS_UNDICI" if undici_ok == len(ids) and len(ids) > 0 else "WARN_UNDICI")
print("PASS_NATIVE_SQLITE" if any(k in sqlite_drivers for k in ("better-sqlite3","bun:sqlite","node:sqlite")) else "WARN_SQLITE")
print("PASS_WAL" if any("wal" in k for k in journal_modes) else "WARN_NOT_WAL")
print("PASS_VERSION" if any(v.startswith("0.5.40-mw.") for v in versions) else "WARN_VERSION")
PY

# --- 4) concurrent claim test against staging redis ---
echo "--- concurrent claim test ---" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
if [[ -f "${RELEASE_DIR}/scripts/tests/mw-concurrent-claim.mjs" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(REDIS_|MW_)' "/etc/9router-mw-staging/env" | grep -v '^#' || true)
  set +a
  export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
  export REDIS_PORT="${REDIS_PORT:-6382}"
  export MW_ALLOW_NON_6381=1
  # Map staging env password into REDIS_PASSWORD for the script
  STAGING_REDIS_PW=$(grep '^REDIS_PASSWORD=' /etc/9router-mw-staging/env | cut -d= -f2-)
  export REDIS_PASSWORD="${STAGING_REDIS_PW}"
  cd "${RELEASE_DIR}" && node scripts/tests/mw-concurrent-claim.mjs 2>&1 | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt" || echo "CLAIM_TEST_EXIT=$?" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
else
  echo "no claim test script" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
fi

# --- 5) k6 light health smoke ---
echo "--- k6 light smoke (20 VU, 15s) ---" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
if command -v k6 >/dev/null 2>&1; then
  cat > /tmp/k6-staging-smoke.js <<'K6'
import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 20, duration: '15s' };
export default function () {
  const r = http.get('http://127.0.0.1:20129/api/health');
  check(r, {
    'status 200': (res) => res.status === 200,
    'ok true': (res) => { try { return res.json('ok') === true; } catch { return false; } },
    'has workerId': (res) => { try { return res.json('workerId') != null; } catch { return false; } },
    'has redis': (res) => { try { return res.json('redis') != null; } catch { return false; } },
  });
}
K6
  k6 run --summary-export "$EVIDENCE_DIR/14-k6-staging-summary.json" /tmp/k6-staging-smoke.js 2>&1 | tail -30 | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt" || true
else
  echo "k6 not installed" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
fi

# --- 6) foreign services still up ---
echo "--- foreign services ---" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E '9router-mw-redis|9router-mw-redis-staging|ggl-redis|app-redis-1|NAMES' | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt" || true
ss -tlnp | grep -E ':20128|:6381' | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt" || true

echo "=== Staging smoke done ===" | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/06-staging-smoke.txt"
