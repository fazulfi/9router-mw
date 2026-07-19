#!/usr/bin/env bash
# Fase 7: load prove — mock upstream, k6 ramp 200, soak, chaos worker kill
# Run as root on VPS. Does NOT touch foreign services.
set -euo pipefail

RELEASE_ID="${RELEASE_ID:-0.5.35-mw.4}"
APP_ROOT="/opt/9router-mw"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_ROOT}/current"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/9router-mw-f7-evidence}"
MOCK_PORT="${MOCK_UPSTREAM_PORT:-18080}"
MOCK_LATENCY_MS="${MOCK_LATENCY_MS:-50}"
SOAK_DURATION="${SOAK_DURATION:-10m}"
SOAK_VUS="${SOAK_VUS:-100}"

mkdir -p "$EVIDENCE_DIR"
echo "=== F7 load prove release=${RELEASE_ID} ===" | tee "$EVIDENCE_DIR/00-start.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/00-start.txt"

# Prefer current release path for scripts
if [[ ! -d "$RELEASE_DIR" ]]; then
  RELEASE_DIR="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  RELEASE_DIR="$(dirname "$(dirname "$RELEASE_DIR")")" 2>/dev/null || true
fi
# scripts live in full git release
SCRIPTS_ROOT="/opt/9router-mw/releases/${RELEASE_ID}"
if [[ ! -f "$SCRIPTS_ROOT/scripts/mock-upstream-server.mjs" ]]; then
  # try current's parent package if assembled differently
  for cand in /opt/9router-mw/releases/*/; do
    if [[ -f "${cand}scripts/mock-upstream-server.mjs" ]]; then
      SCRIPTS_ROOT="${cand%/}"
      break
    fi
  done
fi
echo "SCRIPTS_ROOT=$SCRIPTS_ROOT" | tee "$EVIDENCE_DIR/01-scripts-root.txt"
test -f "$SCRIPTS_ROOT/scripts/mock-upstream-server.mjs"
test -f "$SCRIPTS_ROOT/docs/bench/k6-load-health-200.js"

# --- baseline reference ---
if [[ -f "$SCRIPTS_ROOT/docs/bench/baseline-single-20260718-summary.md" ]]; then
  cat "$SCRIPTS_ROOT/docs/bench/baseline-single-20260718-summary.md" | tee "$EVIDENCE_DIR/02-baseline-ref.txt"
fi

# --- preflight service ---
systemctl is-active 9router-mw | tee "$EVIDENCE_DIR/03-systemd.txt"
MAIN_PID=$(systemctl show -p MainPID --value 9router-mw)
echo "MainPID=$MAIN_PID WORKER_CHILDREN=$(pgrep -P "$MAIN_PID" | wc -l)" | tee -a "$EVIDENCE_DIR/03-systemd.txt"
curl -sS -m 5 http://127.0.0.1:20128/api/health | tee "$EVIDENCE_DIR/03-health.txt"
echo | tee -a "$EVIDENCE_DIR/03-health.txt"

# --- start mock upstream ---
pkill -f mock-upstream-server.mjs 2>/dev/null || true
sleep 1
nohup env MOCK_UPSTREAM_PORT="$MOCK_PORT" MOCK_LATENCY_MS="$MOCK_LATENCY_MS" \
  node "$SCRIPTS_ROOT/scripts/mock-upstream-server.mjs" \
  >"$EVIDENCE_DIR/04-mock-upstream.log" 2>&1 &
echo $! >"$EVIDENCE_DIR/04-mock-pid.txt"
sleep 1
curl -sS -m 3 "http://127.0.0.1:${MOCK_PORT}/health" | tee "$EVIDENCE_DIR/04-mock-health.txt"
echo | tee -a "$EVIDENCE_DIR/04-mock-health.txt"

# --- k6: mock upstream isolation (double-call check via metrics) ---
echo "=== k6 mock upstream ===" | tee "$EVIDENCE_DIR/05-k6-mock.txt"
k6 run \
  -e MOCK_URL="http://127.0.0.1:${MOCK_PORT}" \
  -e K6_SUMMARY_PATH="$EVIDENCE_DIR/05-k6-mock-summary.json" \
  "$SCRIPTS_ROOT/docs/bench/k6-load-mock-upstream.js" 2>&1 | tee -a "$EVIDENCE_DIR/05-k6-mock.txt" || true
curl -sS "http://127.0.0.1:${MOCK_PORT}/metrics" | tee "$EVIDENCE_DIR/05-mock-metrics-after.txt"
echo | tee -a "$EVIDENCE_DIR/05-mock-metrics-after.txt"
python3 - <<'PY' | tee "$EVIDENCE_DIR/05-double-call-check.txt"
import json
m=json.load(open("/tmp/9router-mw-f7-evidence/05-mock-metrics-after.txt"))
# parse k6 summary for http_reqs if present
reqs=None
try:
    s=json.load(open("/tmp/9router-mw-f7-evidence/05-k6-mock-summary.json"))
    reqs=s.get("metrics",{}).get("http_reqs",{}).get("values",{}).get("count")
except Exception as e:
    print("summary_parse_err", e)
print("mock_requests", m.get("requests"))
print("k6_http_reqs", reqs)
if reqs is not None and m.get("requests") is not None:
    # allow small slack for health probes
    ratio = m["requests"] / max(1, reqs)
    print("upstream_per_client", round(ratio, 4))
    print("PASS_NO_DOUBLE" if 0.95 <= ratio <= 1.05 else "WARN_RATIO")
else:
    print("WARN_MISSING_COUNTS")
PY

# --- k6: ramp to 200 VU on gateway health ---
echo "=== k6 load health 200 ===" | tee "$EVIDENCE_DIR/06-k6-load-200.txt"
k6 run \
  -e BASE_URL=http://127.0.0.1:20128 \
  -e K6_SUMMARY_PATH="$EVIDENCE_DIR/06-k6-load-200-summary.json" \
  "$SCRIPTS_ROOT/docs/bench/k6-load-health-200.js" 2>&1 | tee -a "$EVIDENCE_DIR/06-k6-load-200.txt" || true

python3 - <<'PY' | tee "$EVIDENCE_DIR/06-throughput-vs-baseline.txt"
import json
baseline_rps = 358.0  # F2 single-process ~358 rps @ 20 VU health
try:
    s=json.load(open("/tmp/9router-mw-f7-evidence/06-k6-load-200-summary.json"))
    m=s.get("metrics",{})
    http_reqs=m.get("http_reqs",{}).get("values",{})
    count=http_reqs.get("count")
    rate=http_reqs.get("rate")
    fail=m.get("http_req_failed",{}).get("values",{}).get("rate")
    p95=m.get("http_req_duration",{}).get("values",{}).get("p(95)")
    print("http_reqs", count)
    print("rps", rate)
    print("fail_rate", fail)
    print("p95_ms", p95)
    if rate:
        print("ratio_vs_baseline_358", round(rate/baseline_rps, 3))
        print("PASS_1_5X" if rate >= 1.5*baseline_rps else "WARN_BELOW_1_5X")
    print("PASS_P95" if (p95 is not None and p95 < 2000) else "WARN_P95")
    print("PASS_ERR" if (fail is not None and fail < 0.01) else "WARN_ERR")
except Exception as e:
    print("ERR", e)
PY

# --- soak ---
echo "=== k6 soak ${SOAK_VUS} VU ${SOAK_DURATION} ===" | tee "$EVIDENCE_DIR/07-k6-soak.txt"
# memory sample before
ps -o pid,rss,cmd -p "$MAIN_PID" | tee "$EVIDENCE_DIR/07-mem-before.txt"
pgrep -P "$MAIN_PID" | while read p; do ps -o pid,rss,cmd -p "$p"; done | tee -a "$EVIDENCE_DIR/07-mem-before.txt"
k6 run \
  -e BASE_URL=http://127.0.0.1:20128 \
  -e SOAK_DURATION="$SOAK_DURATION" \
  -e SOAK_VUS="$SOAK_VUS" \
  -e K6_SUMMARY_PATH="$EVIDENCE_DIR/07-k6-soak-summary.json" \
  "$SCRIPTS_ROOT/docs/bench/k6-soak-health.js" 2>&1 | tee -a "$EVIDENCE_DIR/07-k6-soak.txt" || true
ps -o pid,rss,cmd -p "$MAIN_PID" | tee "$EVIDENCE_DIR/07-mem-after.txt"
pgrep -P "$MAIN_PID" | while read p; do ps -o pid,rss,cmd -p "$p"; done | tee -a "$EVIDENCE_DIR/07-mem-after.txt"

# --- chaos: kill one worker mid-load ---
echo "=== chaos kill worker ===" | tee "$EVIDENCE_DIR/08-chaos.txt"
MAIN_PID=$(systemctl show -p MainPID --value 9router-mw)
WORKER=$(pgrep -P "$MAIN_PID" | head -1)
echo "kill_worker=$WORKER main=$MAIN_PID t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$EVIDENCE_DIR/08-chaos.txt"
# background k6 light load during chaos
k6 run --vus 20 --duration 20s -e BASE_URL=http://127.0.0.1:20128 \
  "$SCRIPTS_ROOT/docs/bench/k6-baseline-health.js" >"$EVIDENCE_DIR/08-k6-during-chaos.txt" 2>&1 &
K6PID=$!
sleep 3
kill -9 "$WORKER" || true
# wait for respawn
for i in $(seq 1 20); do
  WC=$(pgrep -P "$MAIN_PID" | wc -l)
  echo "t=${i}s workers=$WC" | tee -a "$EVIDENCE_DIR/08-chaos.txt"
  if [[ "$WC" -ge 4 ]]; then
    echo "RESPAWN_OK_SEC=$i" | tee -a "$EVIDENCE_DIR/08-chaos.txt"
    break
  fi
  sleep 1
done
wait $K6PID || true
curl -sS -m 5 http://127.0.0.1:20128/api/health | tee -a "$EVIDENCE_DIR/08-chaos.txt"
echo | tee -a "$EVIDENCE_DIR/08-chaos.txt"
# full service restart timing
T0=$(date +%s%3N)
systemctl restart 9router-mw
for i in $(seq 1 40); do
  if curl -sS -m 1 http://127.0.0.1:20128/api/health | grep -q '"ok":true'; then
    T1=$(date +%s%3N)
    echo "FULL_RESTART_MS=$((T1-T0))" | tee -a "$EVIDENCE_DIR/08-chaos.txt"
    break
  fi
  sleep 0.5
done
sleep 3
pgrep -P "$(systemctl show -p MainPID --value 9router-mw)" | wc -l | tee -a "$EVIDENCE_DIR/08-chaos.txt"

# foreign still ok
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E '9router-mw-redis|ggl-redis|app-redis|NAMES' | tee "$EVIDENCE_DIR/09-foreign-ok.txt" || true

# stop mock
pkill -f mock-upstream-server.mjs 2>/dev/null || true

echo "=== F7 load prove done ===" | tee "$EVIDENCE_DIR/99-done.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/99-done.txt"
