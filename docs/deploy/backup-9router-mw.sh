#!/usr/bin/env bash
# Daily SQLite + config backup for 9router-mw (retain 7 days).
# Install: /usr/local/sbin/backup-9router-mw.sh + cron.d
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/lib/9router-mw/backups}"
DB_DIR="${DB_DIR:-/var/lib/9router-mw/db}"
ENV_FILE="${ENV_FILE:-/etc/9router-mw/env}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="${BACKUP_ROOT}/${STAMP}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"

mkdir -p "$DEST"
chmod 700 "$BACKUP_ROOT" 2>/dev/null || true

# Prefer online backup via sqlite3 if available; else copy with WAL checkpoint attempt
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "${DB_DIR}/data.sqlite" ]]; then
  sqlite3 "${DB_DIR}/data.sqlite" ".backup '${DEST}/data.sqlite'" 2>/dev/null \
    || cp -a "${DB_DIR}/data.sqlite" "${DEST}/data.sqlite"
else
  cp -a "${DB_DIR}/data.sqlite" "${DEST}/data.sqlite" 2>/dev/null || true
fi
# Include wal/shm if present (crash-consistent enough for v1)
cp -a "${DB_DIR}/data.sqlite-wal" "${DEST}/" 2>/dev/null || true
cp -a "${DB_DIR}/data.sqlite-shm" "${DEST}/" 2>/dev/null || true

# env without dumping secrets into world-readable places — root only
if [[ -f "$ENV_FILE" ]]; then
  install -m 0600 -o root -g root "$ENV_FILE" "${DEST}/env.redacted" 2>/dev/null || true
  # strip password lines for safer local copies (keep structure)
  sed -E 's/^(REDIS_PASSWORD|REDIS_URL|JWT_SECRET|INITIAL_PASSWORD)=.*/\1=[redacted]/' \
    "$ENV_FILE" > "${DEST}/env.redacted" 2>/dev/null || true
  chmod 0600 "${DEST}/env.redacted" 2>/dev/null || true
fi

# tar bundle
tar -czf "${BACKUP_ROOT}/9router-mw-${STAMP}.tgz" -C "$DEST" .
rm -rf "$DEST"

# retain
find "$BACKUP_ROOT" -maxdepth 1 -type f -name '9router-mw-*.tgz' -mtime +"${RETAIN_DAYS}" -delete 2>/dev/null || true

echo "OK backup ${BACKUP_ROOT}/9router-mw-${STAMP}.tgz"
ls -lah "$BACKUP_ROOT" | tail -n 15
