#!/usr/bin/env bash
# Stage provisioning for 9router-MW v0.5.40-mw.0
# Runs on VPS as root. Isolated from production (20128/6381).
# Staging uses port 20129, Redis 6382, dedicated paths and credentials.
#
# Idempotent: re-running stops existing staging first, then re-provisions.
# CRITICAL: Never reads /etc/9router-mw/env (production). All credentials generated fresh.
set -euo pipefail

RELEASE_ID="${RELEASE_ID:-0.5.40-mw.0}"
REPO_URL="${REPO_URL:-https://github.com/fazulfi/9router-mw.git}"
BRANCH="${BRANCH:-integration/v0.5.40}"
APP_ROOT="/opt/9router-mw-staging"
DATA_DIR="/var/lib/9router-mw-staging"
CONFIG_DIR="/etc/9router-mw-staging"
SERVICE_NAME="9router-mw-staging"
SERVICE_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
REDIS_CONTAINER="9router-mw-redis-staging"
REDIS_PORT="6382"
APP_PORT="20129"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/9router-mw-staging-v0.5.40-evidence}"
APP_USER="router"

mkdir -p "$EVIDENCE_DIR"
echo "=== Stage provision release=${RELEASE_ID} branch=${BRANCH} ===" | tee "$EVIDENCE_DIR/00-start.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/00-start.txt"

# --- stop existing staging (idempotent) ---
if systemctl list-unit-files "${SERVICE_NAME}.service" 2>/dev/null | grep -q "^${SERVICE_NAME}"; then
  echo "Stopping existing ${SERVICE_NAME}" | tee -a "$EVIDENCE_DIR/00-start.txt"
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
fi
if docker ps -a --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}\$"; then
  echo "Removing existing ${REDIS_CONTAINER}" | tee -a "$EVIDENCE_DIR/00-start.txt"
  docker stop "${REDIS_CONTAINER}" 2>/dev/null || true
  docker rm "${REDIS_CONTAINER}" 2>/dev/null || true
fi

# --- ensure app user exists ---
if ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "Creating app user ${APP_USER}" | tee -a "$EVIDENCE_DIR/00-start.txt"
  useradd --system --home /home/"${APP_USER}" --shell /bin/bash "${APP_USER}" 2>/dev/null || true
fi

# --- create directory tree ---
mkdir -p "${APP_ROOT}/releases"
mkdir -p "${DATA_DIR}/db"
mkdir -p "${DATA_DIR}/tokens"
mkdir -p "${DATA_DIR}/backups"
mkdir -p "${DATA_DIR}/logs"
mkdir -p "${DATA_DIR}/redis"
mkdir -p "${CONFIG_DIR}"

chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}" "${DATA_DIR}"
chmod 0700 "${DATA_DIR}"
chmod 0750 "${CONFIG_DIR}"

# --- generate INDEPENDENT staging credentials (NEVER from production) ---
STAGING_REDIS_PASSWORD="$(openssl rand -hex 32)"
STAGING_JWT_SECRET="$(openssl rand -hex 32)"
STAGING_API_KEY_SECRET="$(openssl rand -hex 32)"
STAGING_INITIAL_PASSWORD="$(openssl rand -base64 18 | tr -d '=+/' | head -c 24)"

# --- write staging env file (0640 root:router) ---
cat > "${CONFIG_DIR}/env" <<EOF
# /etc/9router-mw-staging/env — STAGING ONLY (independent credentials)
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ). Never copy from production.

PORT=${APP_PORT}
HOSTNAME=127.0.0.1
HOST=127.0.0.1
WORKERS=4
NODE_ENV=production
DATA_DIR=${DATA_DIR}
NEXT_TELEMETRY_DISABLED=1

# DNS IPv4-first for undici/upstream
NODE_OPTIONS=--dns-result-order=ipv4first

# Logging
LOG_LEVEL=debug
ENABLE_REQUEST_LOGS=true

# F6: ban sql.js in prod multi-worker
MW_REQUIRE_NATIVE_SQLITE=1

# Redis dedicated 6382 (staging) — INDEPENDENT password
REDIS_HOST=127.0.0.1
REDIS_PORT=${REDIS_PORT}
REDIS_PASSWORD=${STAGING_REDIS_PASSWORD}
REDIS_URL=redis://:${STAGING_REDIS_PASSWORD}@127.0.0.1:${REDIS_PORT}/0

# Multi-worker shared state (Fase 4) — staging defaults
MW_SEM_MAX=1
MW_SEM_TTL_SEC=120
MW_CB_FAILURE_THRESHOLD=5
MW_CB_SUCCESS_THRESHOLD=2
MW_CB_OPEN_MS=30000
MW_USAGE_FLUSH_MS=2000
MW_SETTINGS_CACHE_MS=5000

# Dashboard auth — INDEPENDENT staging credentials
JWT_SECRET=${STAGING_JWT_SECRET}
API_KEY_SECRET=${STAGING_API_KEY_SECRET}
INITIAL_PASSWORD=${STAGING_INITIAL_PASSWORD}
AUTH_COOKIE_SECURE=false
EOF
chmod 0640 "${CONFIG_DIR}/env"
chown root:"${APP_USER}" "${CONFIG_DIR}/env"
echo "STAGING_ENV_GENERATED" | tee -a "$EVIDENCE_DIR/00-start.txt"

# Sanity: staging env must NOT contain production ports or secrets
if grep -qE 'PORT=20128\b|REDIS_PORT=6381\b' "${CONFIG_DIR}/env"; then
  echo "FATAL: staging env references production ports" >&2
  exit 1
fi

# --- start Redis staging container (dedicated, isolated port) ---
if ! docker ps -a --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}\$"; then
  echo "Creating ${REDIS_CONTAINER} on port ${REDIS_PORT}" | tee -a "$EVIDENCE_DIR/00-start.txt"
  docker run -d \
    --name "${REDIS_CONTAINER}" \
    --restart unless-stopped \
    -p "127.0.0.1:${REDIS_PORT}:6379" \
    -v "${DATA_DIR}/redis:/data" \
    redis:7-alpine \
    redis-server --requirepass "${STAGING_REDIS_PASSWORD}" --maxmemory 128mb --maxmemory-policy allkeys-lru >/dev/null
fi
docker ps --filter "name=${REDIS_CONTAINER}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | tee "$EVIDENCE_DIR/05-staging-redis.txt"

# --- clone / update release as router ---
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
if [[ -d "${RELEASE_DIR}/.git" ]]; then
  echo "Release dir exists, fetch+reset" | tee -a "$EVIDENCE_DIR/00-start.txt"
  chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"
  sudo -u "${APP_USER}" git -C "${RELEASE_DIR}" fetch --depth 1 origin "${BRANCH}"
  sudo -u "${APP_USER}" git -C "${RELEASE_DIR}" reset --hard "origin/${BRANCH}"
else
  rm -rf "${RELEASE_DIR}"
  mkdir -p "$(dirname "${RELEASE_DIR}")"
  chown "${APP_USER}:${APP_USER}" "$(dirname "${RELEASE_DIR}")"
  sudo -u "${APP_USER}" git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${RELEASE_DIR}"
fi

chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"
cd "${RELEASE_DIR}"
echo "HEAD=$(sudo -u "${APP_USER}" git -C "${RELEASE_DIR}" rev-parse HEAD)" | tee "$EVIDENCE_DIR/02-git-head.txt"
sudo -u "${APP_USER}" git -C "${RELEASE_DIR}" log -1 --oneline | tee -a "$EVIDENCE_DIR/02-git-head.txt"
sudo -u "${APP_USER}" cat "${RELEASE_DIR}/VERSION" 2>/dev/null | tee "$EVIDENCE_DIR/02-version.txt" || true
sudo -u "${APP_USER}" cat "${RELEASE_DIR}/package.json" | grep '"version"' | head -1 | tee -a "$EVIDENCE_DIR/02-version.txt"

# --- npm install + build ---
echo "=== npm install ===" | tee "$EVIDENCE_DIR/03-npm-install.txt"
sudo -u "${APP_USER}" bash -lc "cd '${RELEASE_DIR}' && npm install --include=optional --no-fund --no-audit" 2>&1 | tail -20 | tee -a "$EVIDENCE_DIR/03-npm-install.txt"
test -d "${RELEASE_DIR}/node_modules/ioredis" | tee -a "$EVIDENCE_DIR/03-npm-install.txt"

echo "=== next build ===" | tee "$EVIDENCE_DIR/04-build.txt"
sudo -u "${APP_USER}" bash -lc "cd '${RELEASE_DIR}' && NEXT_TELEMETRY_DISABLED=1 npm run build" 2>&1 | tail -30 | tee -a "$EVIDENCE_DIR/04-build.txt"

# --- assemble standalone (F6 packaging closure) ---
STANDALONE="${RELEASE_DIR}/.next/standalone"
test -d "${STANDALONE}"
if [[ ! -f "${STANDALONE}/server.js" ]]; then
  FOUND=$(find "${STANDALONE}" -name 'server.js' -type f | head -1)
  if [[ -n "${FOUND}" ]]; then
    STANDALONE=$(dirname "${FOUND}")
  fi
fi
test -f "${STANDALONE}/server.js"
echo "STANDALONE=${STANDALONE}" | tee "$EVIDENCE_DIR/05-standalone.txt"

cp -a "${RELEASE_DIR}/custom-server.js" "${STANDALONE}/custom-server.js"
mkdir -p "${STANDALONE}/.next"
if [[ -d "${RELEASE_DIR}/.next/static" ]]; then
  rm -rf "${STANDALONE}/.next/static"
  cp -a "${RELEASE_DIR}/.next/static" "${STANDALONE}/.next/static"
fi
if [[ -d "${RELEASE_DIR}/public" ]]; then
  rm -rf "${STANDALONE}/public"
  cp -a "${RELEASE_DIR}/public" "${STANDALONE}/public"
fi
if [[ -d "${RELEASE_DIR}/open-sse" ]]; then
  rm -rf "${STANDALONE}/open-sse"
  cp -a "${RELEASE_DIR}/open-sse" "${STANDALONE}/open-sse"
fi
if [[ -d "${RELEASE_DIR}/src/mitm" ]]; then
  mkdir -p "${STANDALONE}/src"
  rm -rf "${STANDALONE}/src/mitm"
  cp -a "${RELEASE_DIR}/src/mitm" "${STANDALONE}/src/mitm"
fi
if [[ -d "${RELEASE_DIR}/scripts" ]]; then
  rm -rf "${STANDALONE}/scripts"
  cp -a "${RELEASE_DIR}/scripts" "${STANDALONE}/scripts"
fi

# runtime node_modules
for pkg in better-sqlite3 sql.js ioredis undici; do
  if [[ -d "${RELEASE_DIR}/node_modules/${pkg}" ]]; then
    mkdir -p "${STANDALONE}/node_modules"
    rm -rf "${STANDALONE}/node_modules/${pkg}"
    cp -a "${RELEASE_DIR}/node_modules/${pkg}" "${STANDALONE}/node_modules/${pkg}"
  fi
done
if [[ -d "${RELEASE_DIR}/node_modules/ioredis" ]]; then
  for dep in denque redis-errors redis-parser standard-as-callback cluster-key-slot debug ms lodash.defaults lodash.isarguments; do
    if [[ -d "${RELEASE_DIR}/node_modules/${dep}" ]]; then
      rm -rf "${STANDALONE}/node_modules/${dep}"
      cp -a "${RELEASE_DIR}/node_modules/${dep}" "${STANDALONE}/node_modules/${dep}"
    fi
  done
fi

# copy version files for visibility
cp -a "${RELEASE_DIR}/package.json" "${STANDALONE}/package.json" 2>/dev/null || true
cp -a "${RELEASE_DIR}/VERSION" "${STANDALONE}/VERSION" 2>/dev/null || true

grep -n 'cluster.fork\|MW_WORKER_ID\|resolveWorkerCount' "${STANDALONE}/custom-server.js" | tee "$EVIDENCE_DIR/05-custom-server-grep.txt" || true
ls -d "${STANDALONE}/node_modules/ioredis" 2>/dev/null | tee "$EVIDENCE_DIR/05-ioredis-standalone.txt" || true
ls -d "${STANDALONE}/node_modules/better-sqlite3" 2>/dev/null | tee "$EVIDENCE_DIR/05-better-sqlite3-standalone.txt" || true

chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"
CURRENT_LINK="${APP_ROOT}/current"
ln -sfn "${STANDALONE}" "${CURRENT_LINK}"
chown -h "${APP_USER}:${APP_USER}" "${CURRENT_LINK}" || true
readlink -f "${CURRENT_LINK}" | tee "$EVIDENCE_DIR/06-current-link.txt"

# --- install systemd unit ---
cat > "${SERVICE_UNIT}" <<'EOFUNIT'
[Unit]
Description=9router-MW staging gateway (v0.5.40 integration)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=router
Group=router
WorkingDirectory=/opt/9router-mw-staging/current
EnvironmentFile=/etc/9router-mw-staging/env
ExecStart=/usr/bin/node --max-old-space-size=2048 custom-server.js
Restart=always
RestartSec=3
TimeoutStopSec=15
KillSignal=SIGTERM
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/9router-mw-staging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=9router-mw-staging

[Install]
WantedBy=multi-user.target
EOFUNIT
chmod 0644 "${SERVICE_UNIT}"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" 2>/dev/null || true
systemctl restart "${SERVICE_NAME}"
sleep 8
systemctl is-active "${SERVICE_NAME}" | tee "$EVIDENCE_DIR/07-systemd-active.txt"
systemctl status "${SERVICE_NAME}" --no-pager -l | head -50 | tee "$EVIDENCE_DIR/07-systemd-status.txt"
journalctl -u "${SERVICE_NAME}" -n 100 --no-pager | tee "$EVIDENCE_DIR/07-journal.txt"

# --- verify Redis PING on staging port ---
docker exec "${REDIS_CONTAINER}" redis-cli -a "${STAGING_REDIS_PASSWORD}" --no-auth-warning ping 2>/dev/null | tee "$EVIDENCE_DIR/01-staging-redis-ping.txt" || true

# --- process tree ---
MAIN_PID=$(systemctl show -p MainPID --value "${SERVICE_NAME}")
echo "MainPID=${MAIN_PID}" | tee "$EVIDENCE_DIR/08-processes.txt"
if [[ -n "${MAIN_PID}" && "${MAIN_PID}" != "0" ]]; then
  pstree -p "${MAIN_PID}" 2>/dev/null | tee -a "$EVIDENCE_DIR/08-processes.txt" || true
  pgrep -P "${MAIN_PID}" | tee "$EVIDENCE_DIR/08-worker-pids.txt" || true
  WORKER_COUNT=$(pgrep -P "${MAIN_PID}" | wc -l)
  echo "WORKER_CHILDREN=${WORKER_COUNT}" | tee -a "$EVIDENCE_DIR/08-processes.txt"
fi
ss -tlnp | grep "${APP_PORT}" | tee "$EVIDENCE_DIR/09-listen.txt" || true

# --- foreign services still up ---
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E '9router-mw-redis|ggl-redis|app-redis-1|9router-mw-redis-staging|NAMES' | tee "$EVIDENCE_DIR/13-foreign-ok.txt" || true

echo "=== Stage provision done ===" | tee "$EVIDENCE_DIR/99-done.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/99-done.txt"
