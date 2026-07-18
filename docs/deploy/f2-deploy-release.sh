#!/usr/bin/env bash
# Fase 2: deploy single-process baseline to /opt/9router-mw
# Run as root on VPS. Does NOT touch foreign services.
set -euo pipefail

RELEASE_ID="${RELEASE_ID:-0.5.35-mw.0}"
REPO_URL="${REPO_URL:-https://github.com/fazulfi/9router-mw.git}"
BRANCH="${BRANCH:-master}"
APP_ROOT="/opt/9router-mw"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_ROOT}/current"
DATA_DIR="/var/lib/9router-mw"
ENV_FILE="/etc/9router-mw/env"
SERVICE_UNIT="/etc/systemd/system/9router-mw.service"
NGINX_SITE_AVAIL="/etc/nginx/sites-available/router.budgezen.com"
NGINX_SITE_EN="/etc/nginx/sites-enabled/router.budgezen.com"
LOG_DIR="/var/log/9router-mw"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/9router-mw-f2-evidence}"

mkdir -p "$EVIDENCE_DIR" "$LOG_DIR"
chown router:router "$LOG_DIR" || true

echo "=== F2 deploy release=${RELEASE_ID} ===" | tee "$EVIDENCE_DIR/00-start.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/00-start.txt"

# --- preflight ---
id router
test -f "$ENV_FILE"
ss -tlnp | grep -E '20128|6381' | tee "$EVIDENCE_DIR/01-preflight-ports.txt" || true
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | tee "$EVIDENCE_DIR/01-preflight-docker.txt"

# redis ping via docker (host may lack redis-cli)
if grep -q 'REDIS_PASSWORD=' "$ENV_FILE" 2>/dev/null; then
  # shellcheck disable=SC1090
  set -a; source <(grep -E '^[A-Z_]+=.' "$ENV_FILE" | sed 's/\r$//'); set +a
  if [[ -n "${REDIS_PASSWORD:-}" ]]; then
    docker exec 9router-mw-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PING \
      | tee "$EVIDENCE_DIR/01-redis-ping.txt" || echo "REDIS_PING_FAILED" | tee "$EVIDENCE_DIR/01-redis-ping.txt"
  fi
fi

# --- clone / update release ---
if [[ -d "$RELEASE_DIR/.git" ]]; then
  echo "Release dir exists, fetch+reset"
  sudo -u router git -C "$RELEASE_DIR" fetch --depth 1 origin "$BRANCH"
  sudo -u router git -C "$RELEASE_DIR" reset --hard "origin/${BRANCH}"
else
  rm -rf "$RELEASE_DIR"
  sudo -u router mkdir -p "$RELEASE_DIR"
  sudo -u router git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR"
fi

cd "$RELEASE_DIR"
echo "HEAD=$(git rev-parse HEAD)" | tee "$EVIDENCE_DIR/02-git-head.txt"
git log -1 --oneline | tee -a "$EVIDENCE_DIR/02-git-head.txt"

# --- ensure secrets in env ---
if ! grep -q '^JWT_SECRET=' "$ENV_FILE" || grep -q 'change-me' "$ENV_FILE" 2>/dev/null; then
  JWT=$(openssl rand -hex 32)
  INITPASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  # append if missing
  if ! grep -q '^JWT_SECRET=' "$ENV_FILE"; then
    {
      echo "JWT_SECRET=${JWT}"
      echo "INITIAL_PASSWORD=${INITPASS}"
      echo "HOSTNAME=127.0.0.1"
      echo "NODE_ENV=production"
      echo "NEXT_TELEMETRY_DISABLED=1"
      echo "AUTH_COOKIE_SECURE=false"
      echo "API_KEY_SECRET=endpoint-proxy-api-key-secret"
      echo "MACHINE_ID_SALT=endpoint-proxy-salt"
    } >> "$ENV_FILE"
    echo "Generated JWT_SECRET + INITIAL_PASSWORD" | tee "$EVIDENCE_DIR/02-secrets-generated.txt"
  fi
fi

# ensure HOSTNAME + NODE_ENV
grep -q '^HOSTNAME=' "$ENV_FILE" || echo 'HOSTNAME=127.0.0.1' >> "$ENV_FILE"
grep -q '^NODE_ENV=' "$ENV_FILE" || echo 'NODE_ENV=production' >> "$ENV_FILE"
grep -q '^NEXT_TELEMETRY_DISABLED=' "$ENV_FILE" || echo 'NEXT_TELEMETRY_DISABLED=1' >> "$ENV_FILE"
chmod 0640 "$ENV_FILE"
chown root:router "$ENV_FILE"

# --- npm install + build (as router) ---
echo "=== npm ci ===" | tee "$EVIDENCE_DIR/03-npm-ci.txt"
sudo -u router bash -lc "cd '$RELEASE_DIR' && npm ci --include=optional" 2>&1 | tee -a "$EVIDENCE_DIR/03-npm-ci.txt"

echo "=== next build ===" | tee "$EVIDENCE_DIR/04-build.txt"
sudo -u router bash -lc "cd '$RELEASE_DIR' && NEXT_TELEMETRY_DISABLED=1 npm run build" 2>&1 | tee -a "$EVIDENCE_DIR/04-build.txt"

# --- assemble standalone runtime dir ---
STANDALONE="${RELEASE_DIR}/.next/standalone"
test -d "$STANDALONE"
# Next standalone may nest under package name
if [[ ! -f "$STANDALONE/server.js" ]]; then
  # find server.js under standalone
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

# better-sqlite3 into standalone node_modules if present at root
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

# runtime root = standalone (symlink current -> standalone)
chown -R router:router "$RELEASE_DIR"
ln -sfn "$STANDALONE" "$CURRENT_LINK"
chown -h router:router "$CURRENT_LINK" || true
readlink -f "$CURRENT_LINK" | tee "$EVIDENCE_DIR/06-current-link.txt"
ls -la "$CURRENT_LINK" | tee -a "$EVIDENCE_DIR/06-current-link.txt"

# --- systemd unit ---
if [[ -f "$RELEASE_DIR/docs/deploy/9router-mw.service" ]]; then
  cp "$RELEASE_DIR/docs/deploy/9router-mw.service" "$SERVICE_UNIT"
else
  cat > "$SERVICE_UNIT" <<'UNIT'
[Unit]
Description=9router-MW production gateway
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=router
Group=router
WorkingDirectory=/opt/9router-mw/current
EnvironmentFile=/etc/9router-mw/env
ExecStart=/usr/bin/node --max-old-space-size=4096 custom-server.js
Restart=always
RestartSec=3
TimeoutStopSec=30
KillSignal=SIGTERM
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/9router-mw /var/log/9router-mw
MemoryDenyWriteExecute=false
StandardOutput=journal
StandardError=journal
SyslogIdentifier=9router-mw

[Install]
WantedBy=multi-user.target
UNIT
fi

systemctl daemon-reload
systemctl enable 9router-mw
systemctl restart 9router-mw
sleep 4
systemctl is-active 9router-mw | tee "$EVIDENCE_DIR/07-systemd-active.txt"
systemctl status 9router-mw --no-pager -l | head -40 | tee "$EVIDENCE_DIR/07-systemd-status.txt"
journalctl -u 9router-mw -n 80 --no-pager | tee "$EVIDENCE_DIR/07-journal.txt"

# --- listen check ---
ss -tlnp | grep 20128 | tee "$EVIDENCE_DIR/08-listen.txt" || true
curl -sS -m 10 http://127.0.0.1:20128/api/health | tee "$EVIDENCE_DIR/08-health.txt" || true
echo | tee -a "$EVIDENCE_DIR/08-health.txt"

# --- nginx site ---
if [[ -f "$RELEASE_DIR/docs/deploy/nginx-router.budgezen.com.conf" ]]; then
  cp "$RELEASE_DIR/docs/deploy/nginx-router.budgezen.com.conf" "$NGINX_SITE_AVAIL"
fi
ln -sfn "$NGINX_SITE_AVAIL" "$NGINX_SITE_EN"
nginx -t 2>&1 | tee "$EVIDENCE_DIR/09-nginx-t.txt"
systemctl reload nginx
echo "nginx reloaded" | tee "$EVIDENCE_DIR/09-nginx-reload.txt"

# local nginx smoke via Host header (DNS may be missing)
curl -sk -m 10 -H 'Host: router.budgezen.com' https://127.0.0.1/api/health | tee "$EVIDENCE_DIR/10-nginx-health.txt" || true
echo | tee -a "$EVIDENCE_DIR/10-nginx-health.txt"

# foreign services still up
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'ggl-redis|app-redis|gomerch|NAMES' | tee "$EVIDENCE_DIR/11-foreign-ok.txt" || true

echo "=== F2 deploy done ===" | tee "$EVIDENCE_DIR/99-done.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/99-done.txt"
