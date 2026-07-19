#!/usr/bin/env bash
# Rollback 9router-mw current symlink to a previous release directory.
# Usage: rollback-9router-mw.sh [release-id]
# Example: rollback-9router-mw.sh 0.5.35-mw.3
set -euo pipefail

APP_ROOT="/opt/9router-mw"
CURRENT_LINK="${APP_ROOT}/current"
RELEASES="${APP_ROOT}/releases"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Available releases:"
  ls -1 "$RELEASES" 2>/dev/null || true
  echo "Usage: $0 <release-id>"
  exit 1
fi

# Accept either release id or full path
if [[ -d "$TARGET" ]]; then
  DEST="$TARGET"
elif [[ -d "${RELEASES}/${TARGET}" ]]; then
  DEST="${RELEASES}/${TARGET}"
elif [[ -d "${RELEASES}/${TARGET}/.next/standalone" ]]; then
  DEST="${RELEASES}/${TARGET}/.next/standalone"
else
  # Prefer standalone if present under release id
  if [[ -d "${RELEASES}/${TARGET}/.next/standalone" ]]; then
    DEST="${RELEASES}/${TARGET}/.next/standalone"
  else
    echo "Release not found: $TARGET"
    exit 2
  fi
fi

# If DEST is the git checkout, prefer standalone
if [[ -d "${DEST}/.next/standalone" ]]; then
  DEST="${DEST}/.next/standalone"
fi
if [[ ! -f "${DEST}/custom-server.js" && ! -f "${DEST}/server.js" ]]; then
  echo "Invalid release tree (no custom-server.js/server.js): $DEST"
  exit 3
fi

PREV=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
echo "PREV=$PREV"
echo "DEST=$DEST"
T0=$(date +%s%3N)
ln -sfn "$DEST" "$CURRENT_LINK"
chown -h router:router "$CURRENT_LINK" || true
systemctl restart 9router-mw
for i in $(seq 1 60); do
  if curl -sS -m 1 http://127.0.0.1:20128/api/health 2>/dev/null | grep -q '"ok":true'; then
    T1=$(date +%s%3N)
    echo "ROLLBACK_OK_MS=$((T1-T0))"
    curl -sS -m 3 http://127.0.0.1:20128/api/health
    echo
    exit 0
  fi
  sleep 0.5
done
echo "ROLLBACK_FAILED"
exit 4
