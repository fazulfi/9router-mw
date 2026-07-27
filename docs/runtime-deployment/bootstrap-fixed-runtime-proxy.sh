#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/9router-mw}"
APP_USER="${APP_USER:-router}"
PROD_CONFIG="${PROD_CONFIG:-/etc/9router-mw}"
CURRENT_LINK="${APP_ROOT}/current"
TARGET_SLOT=20131
FIXED_PORT=20128
UPSTREAM_FILE="${UPSTREAM_FILE:-/etc/nginx/9router-mw-upstream.conf}"
LOCAL_PROXY_CONFIG="${LOCAL_PROXY_CONFIG:-/etc/nginx/conf.d/9router-mw-local.conf}"
ACTIVE_STATE="${ACTIVE_STATE:-${PROD_CONFIG}/runtime-active-port}"
LOCK_FILE="${LOCK_FILE:-/run/lock/9router-mw-deploy.lock}"
LEGACY_SERVICE="9router-mw.service"
LEGACY_SLOT_SERVICE="9router-mw-slot@20128.service"
IPTABLES_COMMENT="9router-mw-fixed-port-bootstrap"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FATAL: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
health_json() { curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$1/api/health"; }

health_contract() {
  python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
redis = data.get("redis") or {}
hotpath = data.get("hotpath") or {}
undici = hotpath.get("undici") or {}
sqlite = hotpath.get("sqlite") or {}
ok = (
    data.get("ok") is True
    and data.get("workers") == 4
    and redis.get("ok") is True
    and redis.get("ready", True) is True
    and undici.get("enabled") is True
    and sqlite.get("driver") == "better-sqlite3"
    and str(sqlite.get("journalMode", "")).lower() == "wal"
)
raise SystemExit(0 if ok else 1)
'
}

wait_healthy() {
  local port="$1" label="$2" output
  for attempt in $(seq 1 30); do
    output="$(health_json "${port}" 2>/dev/null || true)"
    if [[ -n "${output}" ]] && printf '%s' "${output}" | health_contract; then
      log "${label} healthy (attempt ${attempt})"
      return 0
    fi
    sleep 2
  done
  die "${label} failed the health contract"
}

require_workers() {
  local port="$1" label="$2" seen unique_worker_count
  seen="$({
    for request in $(seq 1 80); do
      (health_json "${port}" 2>/dev/null | python3 -c \
        'import json,sys; print(json.load(sys.stdin).get("workerId", ""))' \
        2>/dev/null || true) &
      if (( request % 16 == 0 )); then wait; fi
    done
    wait
  } | grep -E '^[1-9][0-9]*$' | sort -nu)"
  unique_worker_count="$(printf '%s\n' "${seen}" | sed '/^$/d' | wc -l | tr -d ' ')"
  [[ "${unique_worker_count}" == "4" ]] \
    || die "${label}: expected four unique workers; saw ${seen:-none}"
  log "${label} workers observed: $(printf '%s' "${seen}" | tr '\n' ' ')"
}

retire_legacy_services() {
  local unit unit_path retired_dir retired_path
  retired_dir="${PROD_CONFIG}/retired-units"
  for unit in "${LEGACY_SERVICE}" "${LEGACY_SLOT_SERVICE}"; do
    systemctl stop "${unit}" >/dev/null 2>&1 || true
    systemctl disable "${unit}" >/dev/null 2>&1 || true
    unit_path="/etc/systemd/system/${unit}"
    if [[ -f "${unit_path}" && ! -L "${unit_path}" ]]; then
      install -d -m 0750 "${retired_dir}"
      retired_path="${retired_dir}/${unit}.$(date -u +%Y%m%dT%H%M%SZ)"
      mv "${unit_path}" "${retired_path}"
      log "retired legacy unit file to ${retired_path}"
    fi
    systemctl mask "${unit}" >/dev/null
  done
  systemctl daemon-reload
}

assert_legacy_service_retired() {
  local unit state
  for unit in "${LEGACY_SERVICE}" "${LEGACY_SLOT_SERVICE}"; do
    ! systemctl is-active --quiet "${unit}" || die "legacy ${unit} is still active"
    state="$(systemctl is-enabled "${unit}" 2>/dev/null || true)"
    [[ "${state}" == "masked" || "${state}" == "not-found" ]] \
      || die "legacy ${unit} must be masked or absent; state=${state:-unknown}"
  done
}

reconcile_slot_enablement() {
  local active_port standby_port standby_state
  active_port="$(tr -d '[:space:]' <"${ACTIVE_STATE}")"
  case "${active_port}" in
    20131) standby_port=20132 ;;
    20132) standby_port=20131 ;;
    *) die "active runtime slot state is invalid" ;;
  esac
  systemctl enable "9router-mw-slot@${active_port}.service" >/dev/null
  standby_state="$(systemctl is-enabled "9router-mw-slot@${standby_port}.service" 2>/dev/null || true)"
  if [[ "${standby_state}" == "enabled" ]]; then
    systemctl disable "9router-mw-slot@${standby_port}.service" >/dev/null
  fi
}

assert_steady_state_runtime() {
  local active_port standby_port active_state standby_state
  [[ -f "${ACTIVE_STATE}" ]] || die "active runtime slot state is missing"
  active_port="$(tr -d '[:space:]' <"${ACTIVE_STATE}")"
  case "${active_port}" in
    20131) standby_port=20132 ;;
    20132) standby_port=20131 ;;
    *) die "active runtime slot state is invalid" ;;
  esac
  assert_legacy_service_retired
  systemctl is-active --quiet "9router-mw-slot@${active_port}.service" \
    || die "active runtime slot ${active_port} is not active"
  ! systemctl is-active --quiet "9router-mw-slot@${standby_port}.service" \
    || die "standby runtime slot ${standby_port} is unexpectedly active"
  active_state="$(systemctl is-enabled "9router-mw-slot@${active_port}.service" 2>/dev/null || true)"
  standby_state="$(systemctl is-enabled "9router-mw-slot@${standby_port}.service" 2>/dev/null || true)"
  [[ "${active_state}" == "enabled" ]] \
    || die "active runtime slot ${active_port} must be enabled; state=${active_state:-unknown}"
  [[ "${standby_state}" == "disabled" || "${standby_state}" == "masked" || "${standby_state}" == "not-found" ]] \
    || die "standby runtime slot ${standby_port} must not be enabled; state=${standby_state:-unknown}"
}

assert_private_slots_inactive() {
  local port
  for port in 20131 20132; do
    ! systemctl is-active --quiet "9router-mw-slot@${port}.service" \
      || die "private runtime slot ${port} is active before bootstrap"
  done
}

bridge_exists() {
  iptables -w -t nat -C OUTPUT -p tcp -d 127.0.0.1 --dport "${FIXED_PORT}" \
    -m comment --comment "${IPTABLES_COMMENT}" -j REDIRECT --to-ports "${TARGET_SLOT}" \
    >/dev/null 2>&1
}

add_bridge() {
  bridge_exists || iptables -w -t nat -I OUTPUT 1 -p tcp -d 127.0.0.1 \
    --dport "${FIXED_PORT}" -m comment --comment "${IPTABLES_COMMENT}" \
    -j REDIRECT --to-ports "${TARGET_SLOT}"
}

remove_bridge() {
  while bridge_exists; do
    iptables -w -t nat -D OUTPUT -p tcp -d 127.0.0.1 --dport "${FIXED_PORT}" \
      -m comment --comment "${IPTABLES_COMMENT}" -j REDIRECT --to-ports "${TARGET_SLOT}"
  done
}

write_upstream() {
  local port="$1" tmp="${UPSTREAM_FILE}.tmp.$$"
  printf '    server 127.0.0.1:%s;\n' "${port}" >"${tmp}"
  chmod 0644 "${tmp}"
  mv -f "${tmp}" "${UPSTREAM_FILE}"
}

[[ "${EUID}" -eq 0 ]] || die "run as root on the VPS"
[[ "$(uname -s)" == "Linux" && -d /run/systemd/system ]] \
  || die "this script only runs on the systemd VPS"
[[ -f "${PROD_CONFIG}/env" ]] || die "production VPS configuration not found"
for command in curl python3 flock systemctl nginx ss iptables; do need "${command}"; done
[[ -f /etc/systemd/system/9router-mw-slot@.service ]] || die "runtime slot unit template is missing"
[[ -f "${UPSTREAM_FILE}" ]] || die "Nginx upstream include is missing"
mkdir -p "$(dirname "${LOCK_FILE}")" "${APP_ROOT}/slots" "${PROD_CONFIG}"
exec 9>"${LOCK_FILE}"
flock -n 9 || die "another deployment is running"

if [[ -f "${LOCAL_PROXY_CONFIG}" ]] && \
  ss -ltnp '( sport = :20128 )' 2>/dev/null | grep -q nginx; then
  log "fixed production proxy is already bootstrapped"
  wait_healthy "${FIXED_PORT}" "fixed production endpoint"
  require_workers "${FIXED_PORT}" "fixed production endpoint"
  retire_legacy_services
  reconcile_slot_enablement
  assert_steady_state_runtime
  exit 0
fi

wait_healthy "${FIXED_PORT}" "current production"
require_workers "${FIXED_PORT}" "current production"
[[ -L "${CURRENT_LINK}" ]] || die "current production symlink is missing"
CURRENT_TARGET="$(readlink -f "${CURRENT_LINK}")"
[[ -f "${CURRENT_TARGET}/custom-server.js" ]] || die "current runtime artifact is invalid"
OLD_UPSTREAM="$(cat "${UPSTREAM_FILE}")"

if systemctl is-active --quiet "${LEGACY_SLOT_SERVICE}"; then
  OLD_SERVICE="${LEGACY_SLOT_SERVICE}"
elif systemctl is-active --quiet "${LEGACY_SERVICE}"; then
  OLD_SERVICE="${LEGACY_SERVICE}"
else
  die "cannot identify the service currently owning port 20128"
fi
assert_private_slots_inactive

BRIDGE_ADDED=0
OLD_STOPPED=0
PROXY_FILE_WRITTEN=0
UPSTREAM_CHANGED=0
COMMITTED=0
rollback_bootstrap() {
  local rc=$?
  trap - ERR INT TERM EXIT
  if [[ "${COMMITTED}" -eq 0 ]]; then
    log "bootstrap failed; restoring the direct production listener"
    if [[ "${PROXY_FILE_WRITTEN}" -eq 1 ]]; then
      rm -f "${LOCAL_PROXY_CONFIG}"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    fi
    if [[ "${OLD_STOPPED}" -eq 1 ]]; then
      systemctl enable --now "${OLD_SERVICE}" >/dev/null 2>&1 || systemctl start "${OLD_SERVICE}" || true
    fi
    if [[ "${BRIDGE_ADDED}" -eq 1 ]]; then
      remove_bridge || true
    fi
    if [[ "${UPSTREAM_CHANGED}" -eq 1 ]]; then
      printf '%s\n' "${OLD_UPSTREAM}" >"${UPSTREAM_FILE}"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    fi
    systemctl stop "9router-mw-slot@${TARGET_SLOT}.service" >/dev/null 2>&1 || true
    log "bootstrap rollback complete"
  fi
  exit "${rc}"
}
trap rollback_bootstrap ERR INT TERM EXIT

ln -sfn "${CURRENT_TARGET}" "${APP_ROOT}/slots/${TARGET_SLOT}"
chown -h "${APP_USER}:${APP_USER}" "${APP_ROOT}/slots/${TARGET_SLOT}" || true
cat >"${PROD_CONFIG}/slot-${TARGET_SLOT}.env" <<EOF
PORT=${TARGET_SLOT}
HOST=127.0.0.1
HOSTNAME=127.0.0.1
EOF
chmod 0640 "${PROD_CONFIG}/slot-${TARGET_SLOT}.env"
chown root:"${APP_USER}" "${PROD_CONFIG}/slot-${TARGET_SLOT}.env"
systemctl daemon-reload
systemctl enable --now "9router-mw-slot@${TARGET_SLOT}.service"
wait_healthy "${TARGET_SLOT}" "internal runtime slot ${TARGET_SLOT}"
require_workers "${TARGET_SLOT}" "internal runtime slot ${TARGET_SLOT}"

# New loopback connections continue through the candidate while ownership of
# port 20128 moves from Node to Nginx. Schedule this one-time migration because
# already-established long-lived connections on the old Node process may close.
add_bridge
BRIDGE_ADDED=1
wait_healthy "${FIXED_PORT}" "bridged production endpoint"

write_upstream "${TARGET_SLOT}"
UPSTREAM_CHANGED=1
nginx -t
systemctl reload nginx
systemctl stop "${OLD_SERVICE}"
systemctl disable "${OLD_SERVICE}" >/dev/null 2>&1 || true
OLD_STOPPED=1

cat >"${LOCAL_PROXY_CONFIG}" <<'EOF'
server {
    listen 127.0.0.1:20128;
    server_name 127.0.0.1;

    location / {
        proxy_pass http://9router_mw_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
PROXY_FILE_WRITTEN=1
chmod 0644 "${LOCAL_PROXY_CONFIG}"
nginx -t
systemctl reload nginx
ss -ltnp '( sport = :20128 )' 2>/dev/null | grep -q nginx \
  || die "Nginx did not acquire port 20128"

remove_bridge
BRIDGE_ADDED=0
wait_healthy "${FIXED_PORT}" "fixed Nginx production endpoint"
require_workers "${FIXED_PORT}" "fixed Nginx production endpoint"
printf '%s\n' "${TARGET_SLOT}" >"${ACTIVE_STATE}"
rm -f "${PROD_CONFIG}/active-port" "${APP_ROOT}/slots/20128" "${PROD_CONFIG}/slot-20128.env"
COMMITTED=1
retire_legacy_services
reconcile_slot_enablement
assert_steady_state_runtime
trap - ERR INT TERM EXIT
log "BOOTSTRAP PASS: Nginx owns fixed production endpoint 127.0.0.1:20128"
log "active private runtime slot: ${TARGET_SLOT}"
