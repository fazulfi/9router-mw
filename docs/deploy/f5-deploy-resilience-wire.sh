#!/usr/bin/env bash
# Fase 5: deploy resilience wire (sem/breaker/settings-cache) release 0.5.35-mw.3
# Run as root on VPS. Does NOT touch foreign services (6379/6380).
set -euo pipefail

RELEASE_ID="${RELEASE_ID:-0.5.35-mw.3}"
REPO_URL="${REPO_URL:-https://github.com/fazulfi/9router-mw.git}"
BRANCH="${BRANCH:-master}"
APP_ROOT="/opt/9router-mw"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_ROOT}/current"
ENV_FILE="/etc/9router-mw/env"
SERVICE_UNIT="/etc/systemd/system/9router-mw.service"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/9router-mw-f5-evidence}"

mkdir -p "$EVIDENCE_DIR"
echo "=== F5 deploy release=${RELEASE_ID} ===" | tee "$EVIDENCE_DIR/00-start.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/00-start.txt"

# --- ensure Redis env for MW (6381 only) ---
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^WORKERS=' "$ENV_FILE"; then
    sed -i 's/^WORKERS=.*/WORKERS=4/' "$ENV_FILE"
  else
    echo 'WORKERS=4' >> "$ENV_FILE"
  fi
  grep -q '^HOSTNAME=' "$ENV_FILE" || echo 'HOSTNAME=127.0.0.1' >> "$ENV_FILE"
  grep -q '^NODE_ENV=' "$ENV_FILE" || echo 'NODE_ENV=production' >> "$ENV_FILE"
  grep -q '^REDIS_HOST=' "$ENV_FILE" || echo 'REDIS_HOST=127.0.0.1' >> "$ENV_FILE"
  if grep -q '^REDIS_PORT=' "$ENV_FILE"; then
    sed -i 's/^REDIS_PORT=.*/REDIS_PORT=6381/' "$ENV_FILE"
  else
    echo 'REDIS_PORT=6381' >> "$ENV_FILE"
  fi
  # Build REDIS_URL from password if missing
  if ! grep -q '^REDIS_URL=' "$ENV_FILE"; then
    if grep -q '^REDIS_PASSWORD=' "$ENV_FILE"; then
      # shellcheck disable=SC1090
      set -a
      # shellcheck disable=SC1091
      source <(grep -E '^(REDIS_PASSWORD)=' "$ENV_FILE")
      set +a
      if [[ -n "${REDIS_PASSWORD:-}" ]]; then
        echo "REDIS_URL=redis://:${REDIS_PASSWORD}@127.0.0.1:6381/0" >> "$ENV_FILE"
      fi
    fi
  fi
  chmod 0640 "$ENV_FILE"
  chown root:router "$ENV_FILE"
  grep -E '^(WORKERS|HOSTNAME|PORT|NODE_ENV|REDIS_HOST|REDIS_PORT)=' "$ENV_FILE" | tee "$EVIDENCE_DIR/01-env.txt"
  # never dump password
  grep -E '^(REDIS_URL|REDIS_PASSWORD)=' "$ENV_FILE" | sed 's/=.*/=[redacted]/' | tee -a "$EVIDENCE_DIR/01-env.txt"
fi

# --- redis container health ---
docker ps --filter name=9router-mw-redis --format '{{.Names}} {{.Status}} {{.Ports}}' | tee "$EVIDENCE_DIR/01-redis-docker.txt"
docker exec 9router-mw-redis redis-cli -a "$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)" --no-auth-warning ping 2>/dev/null | tee "$EVIDENCE_DIR/01-redis-ping.txt" || \
  docker exec 9router-mw-redis redis-cli ping 2>/dev/null | tee "$EVIDENCE_DIR/01-redis-ping.txt" || true

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
# verify F4 modules + F5 wire present
ls -la "$RELEASE_DIR/open-sse/services/redisClient.js" \
  "$RELEASE_DIR/open-sse/services/accountSemaphore.js" \
  "$RELEASE_DIR/open-sse/services/circuitBreaker.js" \
  "$RELEASE_DIR/open-sse/services/usageBuffer.js" | tee "$EVIDENCE_DIR/02-modules.txt"
grep -n 'acquireAccountSlot\|getBreakerState\|recordBreakerSuccess' "$RELEASE_DIR/src/sse/handlers/chat.js" | tee "$EVIDENCE_DIR/02-chat-wire.txt"
grep -n 'invalidateSettingsCache\|SETTINGS_CACHE_TTL' "$RELEASE_DIR/src/lib/db/repos/settingsRepo.js" | tee "$EVIDENCE_DIR/02-settings-cache.txt"
grep -n ioredis "$RELEASE_DIR/package.json" | tee "$EVIDENCE_DIR/02-ioredis-dep.txt"

# --- npm install + build ---
echo "=== npm install ===" | tee "$EVIDENCE_DIR/03-npm-install.txt"
sudo -u router bash -lc "cd '$RELEASE_DIR' && npm install --include=optional --no-fund --no-audit" 2>&1 | tee -a "$EVIDENCE_DIR/03-npm-install.txt"
test -d "$RELEASE_DIR/node_modules/ioredis" | tee -a "$EVIDENCE_DIR/03-npm-install.txt"
ls -d "$RELEASE_DIR/node_modules/ioredis" | tee -a "$EVIDENCE_DIR/03-npm-install.txt"

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
if [[ -d "$RELEASE_DIR/scripts" ]]; then
  rm -rf "$STANDALONE/scripts"
  cp -a "$RELEASE_DIR/scripts" "$STANDALONE/scripts"
fi
# native / external packages needed at runtime
for pkg in better-sqlite3 sql.js ioredis; do
  if [[ -d "$RELEASE_DIR/node_modules/$pkg" ]]; then
    mkdir -p "$STANDALONE/node_modules"
    rm -rf "$STANDALONE/node_modules/$pkg"
    cp -a "$RELEASE_DIR/node_modules/$pkg" "$STANDALONE/node_modules/$pkg"
  fi
done
# ioredis deps (denque, redis-errors, redis-parser, standard-as-callback, cluster-key-slot, debug, ms)
if [[ -d "$RELEASE_DIR/node_modules/ioredis" ]]; then
  # copy package + hoist common deps into standalone node_modules
  for dep in denque redis-errors redis-parser standard-as-callback cluster-key-slot debug ms lodash.defaults lodash.isarguments; do
    if [[ -d "$RELEASE_DIR/node_modules/$dep" ]]; then
      rm -rf "$STANDALONE/node_modules/$dep"
      cp -a "$RELEASE_DIR/node_modules/$dep" "$STANDALONE/node_modules/$dep"
    fi
  done
fi

# copy package.json so version visible
cp -a "$RELEASE_DIR/package.json" "$STANDALONE/package.json" 2>/dev/null || true
cp -a "$RELEASE_DIR/VERSION" "$STANDALONE/VERSION" 2>/dev/null || true

grep -n 'cluster.fork\|MW_WORKER_ID\|resolveWorkerCount' "$STANDALONE/custom-server.js" | tee "$EVIDENCE_DIR/05-custom-server-grep.txt"
ls -la "$STANDALONE/open-sse/services/" | tee "$EVIDENCE_DIR/05-services-ls.txt"
ls -d "$STANDALONE/node_modules/ioredis" | tee "$EVIDENCE_DIR/05-ioredis-standalone.txt"

chown -R router:router "$RELEASE_DIR"
ln -sfn "$STANDALONE" "$CURRENT_LINK"
chown -h router:router "$CURRENT_LINK" || true
readlink -f "$CURRENT_LINK" | tee "$EVIDENCE_DIR/06-current-link.txt"

# --- systemd ---
if [[ -f "$RELEASE_DIR/docs/deploy/9router-mw.service" ]]; then
  cp "$RELEASE_DIR/docs/deploy/9router-mw.service" "$SERVICE_UNIT"
fi
systemctl daemon-reload
systemctl restart 9router-mw
sleep 8
systemctl is-active 9router-mw | tee "$EVIDENCE_DIR/07-systemd-active.txt"
systemctl status 9router-mw --no-pager -l | head -50 | tee "$EVIDENCE_DIR/07-systemd-status.txt"
journalctl -u 9router-mw -n 150 --no-pager | tee "$EVIDENCE_DIR/07-journal.txt"

# --- process tree ---
MAIN_PID=$(systemctl show -p MainPID --value 9router-mw)
echo "MainPID=$MAIN_PID" | tee "$EVIDENCE_DIR/08-processes.txt"
if [[ -n "$MAIN_PID" && "$MAIN_PID" != "0" ]]; then
  pstree -p "$MAIN_PID" 2>/dev/null | tee -a "$EVIDENCE_DIR/08-processes.txt" || true
  pgrep -P "$MAIN_PID" | tee "$EVIDENCE_DIR/08-worker-pids.txt" || true
  WORKER_COUNT=$(pgrep -P "$MAIN_PID" | wc -l)
  echo "WORKER_CHILDREN=$WORKER_COUNT" | tee -a "$EVIDENCE_DIR/08-processes.txt"
fi
ss -tlnp | grep 20128 | tee "$EVIDENCE_DIR/09-listen.txt" || true

# --- health samples (expect redis.ok + rotating workerId) ---
: > "$EVIDENCE_DIR/10-health-samples.txt"
for i in $(seq 1 20); do
  curl -sS -m 5 http://127.0.0.1:20128/api/health >> "$EVIDENCE_DIR/10-health-samples.txt" || echo FAIL >> "$EVIDENCE_DIR/10-health-samples.txt"
  echo >> "$EVIDENCE_DIR/10-health-samples.txt"
done

python3 - <<'PY' | tee "$EVIDENCE_DIR/10-health-analysis.txt"
import json, collections
text=open("/tmp/9router-mw-f5-evidence/10-health-samples.txt").read()
ids=[]
redis_ok=0
redis_mode=collections.Counter()
for line in text.splitlines():
    line=line.strip()
    if not line or line=="FAIL": continue
    try:
        o=json.loads(line)
        ids.append(o.get("workerId"))
        r=o.get("redis") or {}
        if r.get("ok"): redis_ok += 1
        redis_mode[r.get("mode") or "missing"] += 1
    except Exception:
        pass
c=collections.Counter(ids)
print("samples", len(ids))
print("unique_workerIds", sorted(c.keys(), key=lambda x: (x is None, str(x))))
print("counts", dict(c))
print("redis_ok_count", redis_ok)
print("redis_modes", dict(redis_mode))
print("PASS_MULTI" if len(c)>=2 else "WARN_FEW_WORKERS")
print("PASS_FOUR" if len(c)>=4 else "WARN_NOT_FOUR")
print("PASS_REDIS" if redis_ok >= max(1, len(ids)//2) else "WARN_REDIS_DEGRADED")
PY

# --- concurrent claim test (as router, with env) ---
echo "=== concurrent claim test ===" | tee "$EVIDENCE_DIR/11-claim-test.txt"
set -a
# shellcheck disable=SC1090
source <(grep -E '^(REDIS_|MW_)' "$ENV_FILE" | grep -v '^#' || true)
set +a
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export REDIS_PORT="${REDIS_PORT:-6381}"
if [[ -x "$RELEASE_DIR/node_modules/.bin/node" ]] || command -v node >/dev/null; then
  sudo -u router env \
    REDIS_HOST="$REDIS_HOST" \
    REDIS_PORT="$REDIS_PORT" \
    REDIS_PASSWORD="${REDIS_PASSWORD:-}" \
    REDIS_URL="${REDIS_URL:-}" \
    HOME=/home/router \
    bash -lc "cd '$RELEASE_DIR' && node scripts/tests/mw-concurrent-claim.mjs" 2>&1 | tee -a "$EVIDENCE_DIR/11-claim-test.txt" || echo "CLAIM_TEST_EXIT=$?" | tee -a "$EVIDENCE_DIR/11-claim-test.txt"
fi

# models smoke
curl -sS -m 15 -o /tmp/f5-models.json -w 'models_http=%{http_code}\n' http://127.0.0.1:20128/api/v1/models | tee "$EVIDENCE_DIR/12-models.txt"
head -c 200 /tmp/f5-models.json | tee -a "$EVIDENCE_DIR/12-models.txt" || true
echo | tee -a "$EVIDENCE_DIR/12-models.txt"

# foreign services still up
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E '9router-mw-redis|ggl-redis|app-redis|NAMES' | tee "$EVIDENCE_DIR/13-foreign-ok.txt" || true

# k6 light smoke
if command -v k6 >/dev/null 2>&1; then
  cat > /tmp/k6-f5-smoke.js <<'K6'
import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 20, duration: '15s' };
export default function () {
  const r = http.get('http://127.0.0.1:20128/api/health');
  check(r, {
    'status 200': (res) => res.status === 200,
    'ok true': (res) => { try { return res.json('ok') === true; } catch { return false; } },
    'has workerId': (res) => { try { return res.json('workerId') != null; } catch { return false; } },
    'has redis': (res) => { try { return res.json('redis') != null; } catch { return false; } },
  });
}
K6
  k6 run --summary-export "$EVIDENCE_DIR/14-k6-summary.json" /tmp/k6-f5-smoke.js 2>&1 | tee "$EVIDENCE_DIR/14-k6-smoke.txt" || true
else
  echo "k6 not installed" | tee "$EVIDENCE_DIR/14-k6-smoke.txt"
fi

echo "=== F5 deploy done ===" | tee "$EVIDENCE_DIR/99-done.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/99-done.txt"
