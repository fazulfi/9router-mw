#!/usr/bin/env bash
# Staging cleanup for 9router-MW v0.5.40-mw.0
# Removes ONLY staging resources. Never touches production, foreign services, or docker volumes globally.
set -euo pipefail

SERVICE_NAME="9router-mw-staging"
SERVICE_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
REDIS_CONTAINER="9router-mw-redis-staging"
APP_ROOT="/opt/9router-mw-staging"
DATA_DIR="/var/lib/9router-mw-staging"
CONFIG_DIR="/etc/9router-mw-staging"

echo "=== Stage cleanup ==="
date -u +%Y-%m-%dT%H:%M:%SZ

# stop + disable service
if systemctl list-unit-files "${SERVICE_NAME}.service" 2>/dev/null | grep -q "^${SERVICE_NAME}"; then
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
fi
rm -f "${SERVICE_UNIT}"
systemctl daemon-reload

# remove staging redis container ONLY (do not touch other containers)
if docker ps -a --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}\$"; then
  docker stop "${REDIS_CONTAINER}" 2>/dev/null || true
  docker rm "${REDIS_CONTAINER}" 2>/dev/null || true
fi

# remove staging paths (data was on bind mount, removed with the dir)
rm -rf "${APP_ROOT}"
rm -rf "${DATA_DIR}"
rm -rf "${CONFIG_DIR}"

echo "Stage cleanup done"
date -u +%Y-%m-%dT%H:%M:%SZ

# explicit confirm: production must still be up
echo "--- post-cleanup production check ---"
systemctl is-active 9router-mw || true
curl -sS -o /dev/null -w "prod_health=%{http_code}\n" http://127.0.0.1:20128/api/health || true
ss -tlnp | grep -E ':20128|:6381' || true
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E '9router-mw-redis|9router-mw-redis-staging|ggl-redis|app-redis-1' || true
