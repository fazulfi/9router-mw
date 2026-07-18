#!/usr/bin/env bash
# Fase 3: deploy multi-worker (cluster.fork ×4) release 0.5.35-mw.1
# Run as root on VPS. Does NOT touch foreign services.
set -euo pipefail

RELEASE_ID="${RELEASE_ID:-0.5.35-mw.1}"
REPO_URL="${REPO_URL:-https://github.com/fazulfi/9router-mw.git}"
BRANCH="${BRANCH:-master}"
APP_ROOT="/opt/9router-mw"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_ROOT}/current"
ENV_FILE="/etc/9router-mw/env"
SERVICE_UNIT="/etc/systemd/system/9router-mw.service"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/9router-mw-f3-evidence}"

mkdir -p "$EVIDENCE_DIR"
echo "=== F3 deploy release=${RELEASE_ID} ===" | tee "$EVIDENCE_DIR/00-start.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/00-start.txt"

# --- force WORKERS=4 in env ---
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^WORKERS=' "$ENV_FILE"; then
    sed -i 's/^WORKERS=.*/WORKERS=4/' "$ENV_FILE"
  else
    echo 'WORKERS=4' >> "$ENV_FILE"
  fi
  grep -q '^HOSTNAME=' "$ENV_FILE" || echo 'HOSTNAME=127.0.0.1' >> "$ENV_FILE"
  grep -q '^NODE_ENV=' "$ENV_FILE" || echo 'NODE_ENV=production' >> "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  chown root:router "$ENV_FILE"
  grep -E '^(WORKERS|HOSTNAME|PORT|NODE_ENV)=' "$ENV_FILE" | tee "$EVIDENCE_DIR/01-env-workers.txt"
fi

# --- clone / update release as router ---
if [[ -d "$RELEASE_DIR/.git" ]]; then
  echo "Release dir exists, fetch+reset"
  chown -R router:router "$RELEASE_DIR"
  sudo -u router git -C "$RELEASE_DIR" fetch --depth 1 origin "$BRANCH"
  sudo -u router git -C "$RELEASE_DIR" reset --hard "origin/${BRANCH}"
else
  rm -rf "$RELEASE_DIR"
  mkdir -p "$(dirname "$RELEASE_DIR")"
  chown router:router "$(dirname "$RELEASE_DIR")"
  sudo -u router git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR"
fi

chown -R router:router "$RELEASE_DIR"
cd "$RELEASE_DIR"
echo "HEAD=$(sudo -u router git -C "$RELEASE_DIR" rev-parse HEAD)" | tee "$EVIDENCE_DIR/02-git-head.txt"
sudo -u router git -C "$RELEASE_DIR" log -1 --oneline | tee -a "$EVIDENCE_DIR/02-git-head.txt"
sudo -u router git -C "$RELEASE_DIR" show HEAD:VERSION 2>/dev/null | tee "$EVIDENCE_DIR/02-version.txt" || true
sudo -u router cat "$RELEASE_DIR/package.json" | grep '"version"' | head -1 | tee -a "$EVIDENCE_DIR/02-version.txt"

# --- npm install + build ---
echo "=== npm install ===" | tee "$EVIDENCE_DIR/03-npm-install.txt"
sudo -u router bash -lc "cd '$RELEASE_DIR' && npm install --include=optional --no-fund --no-audit" 2>&1 | tee -a "$EVIDENCE_DIR/03-npm-install.txt"

echo "=== next build ===" | tee "$EVIDENCE_DIR/04-build.txt"
sudo -u router bash -lc "cd '$RELEASE_DIR' && NEXT_TELEMETRY_DISABLED=1 npm run build" 2>&1 | tee -a "$EVIDENCE_DIR/04-build.txt"

# --- assemble standalone ---
STANDALONE="${RELEASE_DIR}/.next/standalone"
test -d "$STANDALONE"
if [[ ! -f "$STANDALONE/server.js" ]]; then
  FOUND=$(find "$STANDALONE" -name 'server.js' -type f | head -1)
  if [[ -n "$FOUND" ]]; then
    STANDALONE=$(dirname "$FOUND")
  fi
fi
test -f "$STANDALONE/server.js"
echo "STANDALONE=$STANDALONE" | tee "$EVIDENCE_DIR/05-standalone.txt"

cp -a "$RELEASE_DIR/custom-server.js" "$STANDALONE/custom-server.js"
mkdir -p "$STANDALONE/.next"
if [[ -d "$RELEASE_DIR/.next/static" ]]; then
  rm -rf "$STANDALONE/.next/static"
  cp -a "$RELEASE_DIR/.next/static" "$STANDALONE/.next/static"
fi
if [[ -d "$RELEASE_DIR/public" ]]; then
  rm -rf "$STANDALONE/public"
  cp -a "$RELEASE_DIR/public" "$STANDALONE/public"
fi
if [[ -d "$RELEASE_DIR/open-sse" ]]; then
  rm -rf "$STANDALONE/open-sse"
  cp -a "$RELEASE_DIR/open-sse" "$STANDALONE/open-sse"
fi
if [[ -d "$RELEASE_DIR/src/mitm" ]]; then
  mkdir -p "$STANDALONE/src"
  rm -rf "$STANDALONE/src/mitm"
  cp -a "$RELEASE_DIR/src/mitm" "$STANDALONE/src/mitm"
fi
if [[ -d "$RELEASE_DIR/node_modules/better-sqlite3" ]]; then
  mkdir -p "$STANDALONE/node_modules"
  rm -rf "$STANDALONE/node_modules/better-sqlite3"
  cp -a "$RELEASE_DIR/node_modules/better-sqlite3" "$STANDALONE/node_modules/better-sqlite3"
fi
if [[ -d "$RELEASE_DIR/node_modules/sql.js" ]]; then
  mkdir -p "$STANDALONE/node_modules"
  rm -rf "$STANDALONE/node_modules/sql.js"
  cp -a "$RELEASE_DIR/node_modules/sql.js" "$STANDALONE/node_modules/sql.js"
fi

# verify cluster code present
grep -n 'cluster.fork\|MW_WORKER_ID\|resolveWorkerCount' "$STANDALONE/custom-server.js" | tee "$EVIDENCE_DIR/05-custom-server-grep.txt"

chown -R router:router "$RELEASE_DIR"
ln -sfn "$STANDALONE" "$CURRENT_LINK"
chown -h router:router "$CURRENT_LINK" || true
readlink -f "$CURRENT_LINK" | tee "$EVIDENCE_DIR/06-current-link.txt"

# --- systemd (reuse unit from release) ---
if [[ -f "$RELEASE_DIR/docs/deploy/9router-mw.service" ]]; then
  cp "$RELEASE_DIR/docs/deploy/9router-mw.service" "$SERVICE_UNIT"
fi
systemctl daemon-reload
systemctl restart 9router-mw
sleep 6
systemctl is-active 9router-mw | tee "$EVIDENCE_DIR/07-systemd-active.txt"
systemctl status 9router-mw --no-pager -l | head -50 | tee "$EVIDENCE_DIR/07-systemd-status.txt"
journalctl -u 9router-mw -n 120 --no-pager | tee "$EVIDENCE_DIR/07-journal.txt"

# --- process tree: expect 1 primary + 4 workers ---
echo "=== process tree ===" | tee "$EVIDENCE_DIR/08-processes.txt"
ps -eo pid,ppid,user,cmd | grep -E 'custom-server|9router' | grep -v grep | tee -a "$EVIDENCE_DIR/08-processes.txt" || true
pgrep -af 'custom-server.js' | tee -a "$EVIDENCE_DIR/08-processes.txt" || true
# count node processes under service
MAIN_PID=$(systemctl show -p MainPID --value 9router-mw)
echo "MainPID=$MAIN_PID" | tee -a "$EVIDENCE_DIR/08-processes.txt"
if [[ -n "$MAIN_PID" && "$MAIN_PID" != "0" ]]; then
  pstree -p "$MAIN_PID" 2>/dev/null | tee -a "$EVIDENCE_DIR/08-processes.txt" || true
  # children of main
  pgrep -P "$MAIN_PID" | tee "$EVIDENCE_DIR/08-worker-pids.txt" || true
  WORKER_COUNT=$(pgrep -P "$MAIN_PID" | wc -l)
  echo "WORKER_CHILDREN=$WORKER_COUNT" | tee -a "$EVIDENCE_DIR/08-processes.txt"
fi

# --- listen: single shared port ---
ss -tlnp | grep 20128 | tee "$EVIDENCE_DIR/09-listen.txt" || true

# --- health samples (expect rotating workerId) ---
: > "$EVIDENCE_DIR/10-health-samples.txt"
for i in $(seq 1 20); do
  curl -sS -m 5 http://127.0.0.1:20128/api/health >> "$EVIDENCE_DIR/10-health-samples.txt" || echo FAIL >> "$EVIDENCE_DIR/10-health-samples.txt"
  echo >> "$EVIDENCE_DIR/10-health-samples.txt"
done
# unique workerIds
python3 - <<'PY' | tee "$EVIDENCE_DIR/10-worker-ids.txt"
import json,re,collections
text=open("/tmp/9router-mw-f3-evidence/10-health-samples.txt").read()
ids=[]
for line in text.splitlines():
    line=line.strip()
    if not line or line=="FAIL": continue
    try:
        o=json.loads(line)
        ids.append((o.get("workerId"), o.get("pid"), o.get("workers")))
    except Exception:
        pass
c=collections.Counter(i[0] for i in ids)
print("samples", len(ids))
print("unique_workerIds", sorted(c.keys(), key=lambda x: (x is None, str(x))))
print("counts", dict(c))
print("unique_pids", sorted({i[1] for i in ids}))
print("workers_field", {i[2] for i in ids})
print("PASS_MULTI" if len(c)>=2 else "WARN_FEW_WORKERS")
print("PASS_FOUR" if len(c)>=4 else "WARN_NOT_FOUR")
PY

# models smoke
curl -sS -m 15 -o /tmp/f3-models.json -w 'models_http=%{http_code}\n' http://127.0.0.1:20128/api/v1/models | tee "$EVIDENCE_DIR/11-models.txt"
head -c 200 /tmp/f3-models.json | tee -a "$EVIDENCE_DIR/11-models.txt" || true
echo | tee -a "$EVIDENCE_DIR/11-models.txt"

# foreign services still up
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E '9router-mw-redis|ggl-redis|app-redis|NAMES' | tee "$EVIDENCE_DIR/12-foreign-ok.txt" || true

# k6 light smoke 10s if available
if command -v k6 >/dev/null 2>&1; then
  cat > /tmp/k6-f3-smoke.js <<'K6'
import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = { vus: 20, duration: '15s' };
export default function () {
  const r = http.get('http://127.0.0.1:20128/api/health');
  check(r, {
    'status 200': (res) => res.status === 200,
    'ok true': (res) => {
      try { return res.json('ok') === true; } catch { return false; }
    },
    'has workerId': (res) => {
      try { return res.json('workerId') != null; } catch { return false; }
    },
  });
}
K6
  k6 run --summary-export "$EVIDENCE_DIR/13-k6-summary.json" /tmp/k6-f3-smoke.js 2>&1 | tee "$EVIDENCE_DIR/13-k6-smoke.txt" || true
else
  echo "k6 not installed" | tee "$EVIDENCE_DIR/13-k6-smoke.txt"
fi

echo "=== F3 deploy done ===" | tee "$EVIDENCE_DIR/99-done.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/99-done.txt"
