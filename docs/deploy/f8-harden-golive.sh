#!/usr/bin/env bash
# Fase 8: production harden — logrotate, backup cron, rollback tool, drill, tag notes
set -euo pipefail

EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/9router-mw-f8-evidence}"
REPO_URL="${REPO_URL:-https://github.com/fazulfi/9router-mw.git}"
BRANCH="${BRANCH:-master}"
SCRIPTS_ROOT="/opt/9router-mw/shared/f8-scripts"

mkdir -p "$EVIDENCE_DIR" /var/log/9router-mw
chown router:router /var/log/9router-mw 2>/dev/null || true

echo "=== F8 harden ===" | tee "$EVIDENCE_DIR/00-start.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/00-start.txt"

# pull latest docs/scripts
if [[ -d "$SCRIPTS_ROOT/.git" ]]; then
  chown -R router:router "$SCRIPTS_ROOT" || true
  sudo -u router git -C "$SCRIPTS_ROOT" fetch --depth 1 origin "$BRANCH"
  sudo -u router git -C "$SCRIPTS_ROOT" reset --hard "origin/${BRANCH}"
else
  rm -rf "$SCRIPTS_ROOT"
  mkdir -p "$(dirname "$SCRIPTS_ROOT")"
  chown router:router "$(dirname "$SCRIPTS_ROOT")"
  sudo -u router git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SCRIPTS_ROOT"
fi
echo "HEAD=$(sudo -u router git -C "$SCRIPTS_ROOT" rev-parse HEAD)" | tee "$EVIDENCE_DIR/01-scripts-head.txt"
sudo -u router cat "$SCRIPTS_ROOT/VERSION" | tee "$EVIDENCE_DIR/01-version.txt"

# install logrotate
install -m 0644 "$SCRIPTS_ROOT/docs/deploy/logrotate-9router-mw" /etc/logrotate.d/9router-mw
logrotate -d /etc/logrotate.d/9router-mw 2>&1 | tee "$EVIDENCE_DIR/02-logrotate-debug.txt" || true
ls -la /etc/logrotate.d/9router-mw | tee "$EVIDENCE_DIR/02-logrotate-installed.txt"

# install backup script + cron
install -m 0755 "$SCRIPTS_ROOT/docs/deploy/backup-9router-mw.sh" /usr/local/sbin/backup-9router-mw.sh
install -m 0644 "$SCRIPTS_ROOT/docs/deploy/cron-9router-mw" /etc/cron.d/9router-mw
# ensure redis volume perms (F5 incident)
chown -R 999:999 /var/lib/9router-mw/redis 2>/dev/null || true
chmod 700 /var/lib/9router-mw/redis 2>/dev/null || true
# run backup once
/usr/local/sbin/backup-9router-mw.sh 2>&1 | tee "$EVIDENCE_DIR/03-backup-run.txt"
ls -lah /var/lib/9router-mw/backups | tee "$EVIDENCE_DIR/03-backups-ls.txt"

# install rollback
install -m 0755 "$SCRIPTS_ROOT/docs/deploy/rollback-9router-mw.sh" /usr/local/sbin/rollback-9router-mw.sh

# rollback drill: current → previous release → restore current
CURRENT=$(readlink -f /opt/9router-mw/current)
echo "CURRENT=$CURRENT" | tee "$EVIDENCE_DIR/04-rollback-drill.txt"
# find previous release with standalone
PREV=""
for d in $(ls -1dt /opt/9router-mw/releases/*/ 2>/dev/null); do
  id=$(basename "$d")
  if [[ -d "${d}.next/standalone" ]] && [[ "$(readlink -f ${d}.next/standalone)" != "$CURRENT" ]]; then
    PREV="$id"
    break
  fi
done
echo "PREV_CANDIDATE=$PREV" | tee -a "$EVIDENCE_DIR/04-rollback-drill.txt"
if [[ -n "$PREV" ]]; then
  /usr/local/sbin/rollback-9router-mw.sh "$PREV" 2>&1 | tee -a "$EVIDENCE_DIR/04-rollback-drill.txt"
  # restore to latest mw.4 if exists
  if [[ -d /opt/9router-mw/releases/0.5.35-mw.4/.next/standalone ]]; then
    /usr/local/sbin/rollback-9router-mw.sh 0.5.35-mw.4 2>&1 | tee -a "$EVIDENCE_DIR/04-rollback-restore.txt"
  else
    # restore previous CURRENT path
    ln -sfn "$CURRENT" /opt/9router-mw/current
    systemctl restart 9router-mw
    sleep 5
  fi
else
  echo "SKIP_NO_PREV_RELEASE" | tee -a "$EVIDENCE_DIR/04-rollback-drill.txt"
fi

# final health
systemctl is-active 9router-mw | tee "$EVIDENCE_DIR/05-systemd.txt"
systemctl is-enabled 9router-mw | tee -a "$EVIDENCE_DIR/05-systemd.txt"
curl -sS -m 5 http://127.0.0.1:20128/api/health | tee "$EVIDENCE_DIR/05-health.txt"
echo | tee -a "$EVIDENCE_DIR/05-health.txt"
MAIN=$(systemctl show -p MainPID --value 9router-mw)
echo "workers=$(pgrep -P "$MAIN" | wc -l)" | tee -a "$EVIDENCE_DIR/05-health.txt"

# foreign
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E '9router-mw-redis|ggl-redis|app-redis|NAMES' | tee "$EVIDENCE_DIR/06-foreign-ok.txt" || true

# list runbooks present in scripts tree
ls -la "$SCRIPTS_ROOT/docs/runbooks/" | tee "$EVIDENCE_DIR/07-runbooks.txt"

echo "=== F8 done ===" | tee "$EVIDENCE_DIR/99-done.txt"
date -u +%Y-%m-%dT%H:%M:%SZ | tee -a "$EVIDENCE_DIR/99-done.txt"
