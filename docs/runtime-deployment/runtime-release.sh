#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/9router-mw}"
APP_USER="${APP_USER:-router}"
PROD_CONFIG="${PROD_CONFIG:-/etc/9router-mw}"
PROD_DATA="${PROD_DATA:-/var/lib/9router-mw}"
PROD_PORT=20128
PROD_REDIS_PORT=6381
STAGE_ROOT="${STAGE_ROOT:-/opt/9router-mw-staging}"
STAGE_CONFIG="${STAGE_CONFIG:-/etc/9router-mw-staging}"
STAGE_DATA="${STAGE_DATA:-/var/lib/9router-mw-staging}"
STAGE_PORT=20130
STAGE_REDIS_PORT=6383
STAGE_SERVICE="9router-mw-staging.service"
STAGE_REDIS="9router-mw-staging-redis"
SLOTS=(20131 20132)
SLOT_SERVICE="9router-mw-slot@"
UPSTREAM_FILE="${UPSTREAM_FILE:-/etc/nginx/9router-mw-upstream.conf}"
LOCAL_PROXY_CONFIG="${LOCAL_PROXY_CONFIG:-/etc/nginx/conf.d/9router-mw-local.conf}"
ACTIVE_STATE="${ACTIVE_STATE:-${PROD_CONFIG}/runtime-active-port}"
PREVIOUS_STATE="${PREVIOUS_STATE:-${PROD_CONFIG}/runtime-previous-port}"
REPO_URL="${REPO_URL:-https://github.com/fazulfi/9router-mw.git}"
LOCK_FILE="${LOCK_FILE:-/run/lock/9router-mw-deploy.lock}"
SMOKE_CREDENTIAL_FILE="${SMOKE_CREDENTIAL_FILE:-/run/wwma/env-hiyuki}"
SMOKE_API_KEY_NAME="${SMOKE_API_KEY_NAME:-WWMA_HIYUKI_9ROUTER_API_KEY}"
SMOKE_MODEL="${SMOKE_MODEL:-guinevere}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FATAL: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
unit_exists() { systemctl cat "$1" >/dev/null 2>&1; }

require_vps() {
  [[ "${EUID}" -eq 0 ]] || die "run as root on the VPS"
  [[ "$(uname -s)" == "Linux" ]] || die "this script only runs on the VPS; local builds are forbidden"
  [[ -d /run/systemd/system ]] || die "systemd VPS environment not detected"
  [[ -f "${PROD_CONFIG}/env" ]] || die "production VPS configuration not found"
  [[ -d "${APP_ROOT}" && -d "${PROD_DATA}" ]] || die "production VPS paths not found"
}

acquire_lock() {
  mkdir -p "$(dirname "${LOCK_FILE}")"
  exec 9>"${LOCK_FILE}"
  flock -n 9 || die "another deployment is running"
}

health_json() {
  curl --fail --silent --show-error --max-time 5 \
    "http://127.0.0.1:$1/api/health"
}

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
  local port="$1" label="$2" attempts="${3:-30}" output
  for ((attempt = 1; attempt <= attempts; attempt++)); do
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
  local port="$1" label="$2" seen
  seen="$({
    for _ in $(seq 1 300); do
      health_json "${port}" 2>/dev/null | python3 -c \
        'import json,sys; print(json.load(sys.stdin).get("workerId", ""))' \
        2>/dev/null || true
    done
  } | grep -E '^[1-4]$' | sort -nu | tr '\n' ' ')"
  [[ "${seen}" == "1 2 3 4 " ]] || die "${label}: expected workers 1-4; saw ${seen:-none}"
  log "${label} workers observed: ${seen}"
}

repeated_health() {
  local port="$1" count="${2:-20}"
  for _ in $(seq 1 "${count}"); do
    health_json "${port}" | health_contract || die "health request failed on port ${port}"
  done
  log "${count}/${count} health requests passed on port ${port}"
}

provider_smoke() {
  local port="$1" phase="$2" release_id="$3"
  [[ -r "${SMOKE_CREDENTIAL_FILE}" ]] || die "provider smoke credential file is not readable"
  python3 - "${port}" "${phase}" "${release_id}" \
    "${SMOKE_CREDENTIAL_FILE}" "${SMOKE_API_KEY_NAME}" "${SMOKE_MODEL}" <<'PY'
import json
import sys
import urllib.error
import urllib.request

port, phase, release_id, credential_file, key_name, model = sys.argv[1:]
api_key = None
with open(credential_file, encoding="utf-8") as stream:
    for raw_line in stream:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key_name:
            api_key = value.strip().strip("\"").strip("'")
            break
if not api_key:
    raise SystemExit(f"provider smoke key {key_name} is missing")

payload = json.dumps({
    "model": model,
    "messages": [{"role": "user", "content": "Reply with exactly OK"}],
    "stream": False,
    "max_tokens": 8,
}).encode("utf-8")
request = urllib.request.Request(
    f"http://127.0.0.1:{port}/v1/chat/completions",
    data=payload,
    method="POST",
    headers={
        "authorization": f"Bearer {api_key}",
        "content-type": "application/json",
    },
)
try:
    with urllib.request.urlopen(request, timeout=90) as response:
        status = response.status
        body = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit(f"provider smoke failed during {phase}: HTTP {error.code}") from None
except Exception as error:
    raise SystemExit(f"provider smoke failed during {phase}: {type(error).__name__}") from None
finally:
    api_key = None

if status != 200 or body.get("error") or not body.get("choices"):
    raise SystemExit(f"provider smoke returned an invalid response during {phase}")
print(f"provider smoke passed: phase={phase} release={release_id} model={model}")
PY
}

read_env_value() {
  python3 - "$1" "$2" <<'PY'
import sys
path, key = sys.argv[1:]
with open(path, encoding="utf-8") as stream:
    for raw_line in stream:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key:
            print(value.strip().strip('"').strip("'"))
            raise SystemExit(0)
raise SystemExit(1)
PY
}

clone_production_database_to_staging() {
  local source="${PROD_DATA}/db/data.sqlite" target="${STAGE_DATA}/db/data.sqlite"
  [[ -f "${source}" ]] || die "production database not found"
  mkdir -p "$(dirname "${target}")"
  python3 - "${source}" "${target}" <<'PY'
import sqlite3
import sys
with sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True) as source:
    with sqlite3.connect(sys.argv[2]) as target:
        source.backup(target)
PY
  chown -R "${APP_USER}:${APP_USER}" "${STAGE_DATA}"
  chmod 0700 "${STAGE_DATA}" "${STAGE_DATA}/db"
  chmod 0600 "${target}"
}

artifact_hash() {
  tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 \
    --numeric-owner -C "$1" -cf - . | sha256sum | awk '{print $1}'
}

manifest_value() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    print(json.load(stream)[sys.argv[2]])
PY
}

write_manifest() {
  python3 - "$1" "$2" "$3" "$4" "$5" <<'PY'
import datetime, json, sys
path, release_id, source_ref, commit, checksum = sys.argv[1:]
data = {
    "release_id": release_id,
    "source_ref": source_ref,
    "source_commit": commit,
    "artifact_sha256": checksum,
    "built_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with open(path, "w", encoding="utf-8") as stream:
    json.dump(data, stream, indent=2, sort_keys=True)
    stream.write("\n")
PY
}

assert_proxy_topology() {
  [[ -f "${LOCAL_PROXY_CONFIG}" ]] || die "fixed production proxy is not bootstrapped"
  [[ -f "${UPSTREAM_FILE}" && -f "${ACTIVE_STATE}" ]] || die "runtime proxy state is incomplete"
  ss -ltnp '( sport = :20128 )' 2>/dev/null | grep -q nginx || die "Nginx does not own port 20128"
  grep -Eq '^2013[12]$' "${ACTIVE_STATE}" || die "active runtime slot state is invalid"
}

assert_gateways() {
  local unit
  for unit in wwma-gateway-hiyuki.service wwma-gateway-suisui.service; do
    if unit_exists "${unit}"; then
      systemctl is-active --quiet "${unit}" || die "${unit} is not active"
    fi
  done
}

assert_production() {
  assert_proxy_topology
  systemctl is-active --quiet nginx || die "Nginx is not active"
  wait_healthy "${PROD_PORT}" "stable production"
  require_workers "${PROD_PORT}" "stable production"
  assert_gateways
}

validate_source_ref() {
  local ref="$1"
  if [[ "${ref}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    return 0
  fi
  [[ "${ref}" =~ ^v[0-9A-Za-z._-]+$ ]] || die "use an exact v* tag or full 40-character commit SHA"
  git ls-remote --exit-code --tags "${REPO_URL}" "refs/tags/${ref}" >/dev/null \
    || die "tag does not exist on origin: ${ref}"
}

stop_staging() {
  systemctl stop "${STAGE_SERVICE}" >/dev/null 2>&1 || true
  systemctl disable "${STAGE_SERVICE}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${STAGE_SERVICE}"
  systemctl daemon-reload
  docker rm -f "${STAGE_REDIS}" >/dev/null 2>&1 || true
}

assemble_artifact() {
  local source="$1" artifact="$2" standalone="${source}/.next/standalone" package
  [[ -d "${standalone}" ]] || die "Next.js standalone output is missing"
  rm -rf "${artifact}"
  mkdir -p "${artifact}"
  cp -a "${standalone}/." "${artifact}/"
  cp -a "${source}/custom-server.js" "${artifact}/custom-server.js"
  mkdir -p "${artifact}/.next"
  [[ ! -d "${source}/.next/static" ]] || cp -a "${source}/.next/static" "${artifact}/.next/static"
  [[ ! -d "${source}/public" ]] || cp -a "${source}/public" "${artifact}/public"
  [[ ! -d "${source}/open-sse" ]] || cp -a "${source}/open-sse" "${artifact}/open-sse"
  if [[ -d "${source}/src/mitm" ]]; then
    mkdir -p "${artifact}/src"
    cp -a "${source}/src/mitm" "${artifact}/src/mitm"
  fi
  [[ ! -d "${source}/scripts" ]] || cp -a "${source}/scripts" "${artifact}/scripts"
  cp -a "${source}/package.json" "${artifact}/package.json"
  [[ ! -f "${source}/VERSION" ]] || cp -a "${source}/VERSION" "${artifact}/VERSION"
  # Copy dedicated writer (forked by custom-server.js, not in Next.js bundle graph)
  [[ ! -f "${source}/primary-writer.mjs" ]] || cp -a "${source}/primary-writer.mjs" "${artifact}/primary-writer.mjs"
  [[ ! -d "${source}/src/lib/db" ]] || { mkdir -p "${artifact}/src/lib"; cp -a "${source}/src/lib/db" "${artifact}/src/lib/db/"; }
  for package in better-sqlite3 sql.js ioredis undici denque redis-errors \
    redis-parser standard-as-callback cluster-key-slot debug ms \
    lodash.defaults lodash.isarguments; do
    if [[ -d "${source}/node_modules/${package}" ]]; then
      mkdir -p "${artifact}/node_modules"
      rm -rf "${artifact}/node_modules/${package}"
      cp -a "${source}/node_modules/${package}" "${artifact}/node_modules/${package}"
    fi
  done
  [[ -f "${artifact}/custom-server.js" ]] || die "custom-server.js is missing"
  [[ -f "${artifact}/primary-writer.mjs" ]] || die "primary-writer.mjs is missing"
  [[ -f "${artifact}/src/lib/db/schema.js" ]] || die "writer dep schema.js is missing"
  [[ -f "${artifact}/src/lib/db/version.js" ]] || die "writer dep version.js is missing"
  [[ -f "${artifact}/src/lib/db/helpers/jsonCol.js" ]] || die "writer dep jsonCol.js is missing"
  [[ -d "${artifact}/node_modules/better-sqlite3" ]] || die "better-sqlite3 is missing"
  [[ -d "${artifact}/node_modules/ioredis" ]] || die "ioredis is missing"
}

write_staging_unit() {
  cat >"/etc/systemd/system/${STAGE_SERVICE}" <<EOF
[Unit]
Description=9router-MW isolated staging
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${STAGE_ROOT}/current
EnvironmentFile=${STAGE_CONFIG}/env
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
ReadWritePaths=${STAGE_DATA}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "/etc/systemd/system/${STAGE_SERVICE}"
}

stage_release() {
  local source_ref="${1:-}"
  [[ -n "${source_ref}" ]] || die "usage: $0 stage <exact-tag-or-full-commit-sha>"
  validate_source_ref "${source_ref}"
  assert_production
  stop_staging
  rm -rf "${STAGE_DATA}" "${STAGE_CONFIG}"
  mkdir -p "${STAGE_ROOT}/builds" "${STAGE_ROOT}/artifacts" \
    "${STAGE_ROOT}/manifests" "${STAGE_ROOT}/approvals" "${STAGE_DATA}" "${STAGE_CONFIG}"

  local fetch_dir="${STAGE_ROOT}/builds/.fetch-$$"
  mkdir -p "${fetch_dir}"
  chown -R "${APP_USER}:${APP_USER}" "${fetch_dir}"
  sudo -u "${APP_USER}" git -C "${fetch_dir}" init --quiet
  sudo -u "${APP_USER}" git -C "${fetch_dir}" remote add origin "${REPO_URL}"
  sudo -u "${APP_USER}" git -C "${fetch_dir}" fetch --quiet --depth 1 origin "${source_ref}"
  sudo -u "${APP_USER}" git -C "${fetch_dir}" checkout --quiet --detach FETCH_HEAD

  local commit short release_id build_dir source artifact manifest checksum
  commit="$(sudo -u "${APP_USER}" git -C "${fetch_dir}" rev-parse HEAD)"
  if [[ "${source_ref}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    [[ "${commit,,}" == "${source_ref,,}" ]] || die "fetched commit does not match requested SHA"
  fi
  short="${commit:0:12}"
  release_id="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${short}}"
  [[ "${release_id}" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid release ID"
  build_dir="${STAGE_ROOT}/builds/${release_id}"
  source="${build_dir}/source"
  artifact="${STAGE_ROOT}/artifacts/${release_id}"
  manifest="${STAGE_ROOT}/manifests/${release_id}.json"
  [[ ! -e "${build_dir}" && ! -e "${artifact}" && ! -e "${manifest}" ]] || die "release ID already exists"
  mkdir -p "${build_dir}"
  mv "${fetch_dir}" "${source}"
  chown -R "${APP_USER}:${APP_USER}" "${build_dir}"

  log "building ${release_id} on the VPS from ${commit}"
  sudo -u "${APP_USER}" bash -lc "cd '${source}' && npm install --include=optional --no-audit --no-fund"
  sudo -u "${APP_USER}" bash -lc "cd '${source}' && NEXT_TELEMETRY_DISABLED=1 npm run build"
  assemble_artifact "${source}" "${artifact}"
  chown -R "${APP_USER}:${APP_USER}" "${artifact}"
  checksum="$(artifact_hash "${artifact}")"
  write_manifest "${manifest}" "${release_id}" "${source_ref}" "${commit}" "${checksum}"
  chmod 0644 "${manifest}"

  local redis_password jwt_secret api_key_secret initial_password
  redis_password="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 32)"
  api_key_secret="$(read_env_value "${PROD_CONFIG}/env" API_KEY_SECRET)" \
    || die "production API_KEY_SECRET is required for the isolated smoke-test snapshot"
  initial_password="$(openssl rand -hex 16)"
  clone_production_database_to_staging
  cat >"${STAGE_CONFIG}/env" <<EOF
PORT=${STAGE_PORT}
HOST=127.0.0.1
HOSTNAME=127.0.0.1
WORKERS=4
NODE_ENV=production
DATA_DIR=${STAGE_DATA}
NEXT_TELEMETRY_DISABLED=1
NODE_OPTIONS=--dns-result-order=ipv4first
LOG_LEVEL=debug
ENABLE_REQUEST_LOGS=true
MW_REQUIRE_NATIVE_SQLITE=1
REDIS_HOST=127.0.0.1
REDIS_PORT=${STAGE_REDIS_PORT}
REDIS_PASSWORD=${redis_password}
REDIS_URL=redis://:${redis_password}@127.0.0.1:${STAGE_REDIS_PORT}/0
JWT_SECRET=${jwt_secret}
API_KEY_SECRET=${api_key_secret}
INITIAL_PASSWORD=${initial_password}
AUTH_COOKIE_SECURE=false
EOF
  chmod 0640 "${STAGE_CONFIG}/env"
  chown root:"${APP_USER}" "${STAGE_CONFIG}/env"
  chown -R "${APP_USER}:${APP_USER}" "${STAGE_DATA}"
  ln -sfn "${artifact}" "${STAGE_ROOT}/current"
  chown -h "${APP_USER}:${APP_USER}" "${STAGE_ROOT}/current" || true

  docker run -d --name "${STAGE_REDIS}" --restart unless-stopped \
    -p "127.0.0.1:${STAGE_REDIS_PORT}:6379" \
    -v "${STAGE_DATA}/redis:/data" redis:7-alpine \
    redis-server --requirepass "${redis_password}" --maxmemory 128mb \
    --maxmemory-policy allkeys-lru >/dev/null
  write_staging_unit
  systemctl daemon-reload
  systemctl enable --now "${STAGE_SERVICE}"
  wait_healthy "${STAGE_PORT}" "staging ${release_id}" 45
  require_workers "${STAGE_PORT}" "staging ${release_id}"
  provider_smoke "${STAGE_PORT}" "staging" "${release_id}"
  assert_production
  log "STAGE PASS: release_id=${release_id} commit=${commit} sha256=${checksum}"
}

approve_release() {
  local release_id="${1:-}" evidence="${2:-}" manifest
  [[ "${release_id}" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid release ID"
  [[ -n "${evidence}" ]] || die "usage: $0 approve <release-id> '<evidence-reference>'"
  manifest="${STAGE_ROOT}/manifests/${release_id}.json"
  [[ -f "${manifest}" ]] || die "manifest not found"
  wait_healthy "${STAGE_PORT}" "staging ${release_id}"
  require_workers "${STAGE_PORT}" "staging ${release_id}"
  provider_smoke "${STAGE_PORT}" "approval" "${release_id}"
  printf 'approved_at_utc=%s\napproved_by=%s\nevidence=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SUDO_USER:-root}" "${evidence}" \
    >"${STAGE_ROOT}/approvals/${release_id}.approved"
  chmod 0600 "${STAGE_ROOT}/approvals/${release_id}.approved"
  log "staging acceptance recorded for ${release_id}"
}

backup_database() {
  local release_id="$1" backup_dir="${PROD_DATA}/db/backups" backup
  backup="${backup_dir}/pre-${release_id}-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  mkdir -p "${backup_dir}"
  [[ -f "${PROD_DATA}/db/data.sqlite" ]] || die "production database not found"
  python3 - "${PROD_DATA}/db/data.sqlite" "${backup}" <<'PY'
import sqlite3, sys
with sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True) as source:
    with sqlite3.connect(sys.argv[2]) as target:
        source.backup(target)
PY
  chown "${APP_USER}:${APP_USER}" "${backup}"
  chmod 0600 "${backup}"
  printf '%s\n' "${backup}"
}

write_slot_env() {
  cat >"${PROD_CONFIG}/slot-$1.env" <<EOF
PORT=$1
HOST=127.0.0.1
HOSTNAME=127.0.0.1
EOF
  chmod 0640 "${PROD_CONFIG}/slot-$1.env"
  chown root:"${APP_USER}" "${PROD_CONFIG}/slot-$1.env"
}

switch_upstream() {
  local port="$1" tmp="${UPSTREAM_FILE}.tmp.$$" backup="${UPSTREAM_FILE}.rollback.$$"
  cp -a "${UPSTREAM_FILE}" "${backup}"
  printf '    server 127.0.0.1:%s;\n' "${port}" >"${tmp}"
  chmod 0644 "${tmp}"
  mv -f "${tmp}" "${UPSTREAM_FILE}"
  if ! nginx -t || ! systemctl reload nginx; then
    mv -f "${backup}" "${UPSTREAM_FILE}"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    return 1
  fi
  rm -f "${backup}"
}

promote_release() {
  local release_id="${1:-}" manifest approval stage_artifact expected_hash actual_hash
  [[ "${release_id}" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid release ID"
  assert_production
  manifest="${STAGE_ROOT}/manifests/${release_id}.json"
  approval="${STAGE_ROOT}/approvals/${release_id}.approved"
  stage_artifact="${STAGE_ROOT}/artifacts/${release_id}"
  [[ -f "${manifest}" && -f "${approval}" ]] || die "manifest or approval is missing"
  [[ "$(readlink -f "${STAGE_ROOT}/current")" == "$(readlink -f "${stage_artifact}")" ]] \
    || die "requested release is not current staging"
  wait_healthy "${STAGE_PORT}" "staging ${release_id}"
  require_workers "${STAGE_PORT}" "staging ${release_id}"
  provider_smoke "${STAGE_PORT}" "pre-promotion staging" "${release_id}"
  expected_hash="$(manifest_value "${manifest}" artifact_sha256)"
  actual_hash="$(artifact_hash "${stage_artifact}")"
  [[ "${actual_hash}" == "${expected_hash}" ]] || die "staging artifact checksum changed"

  local old_port new_port old_target old_upstream backup_path release_dir prod_artifact
  old_port="$(tr -d '[:space:]' <"${ACTIVE_STATE}")"
  case "${old_port}" in
    20131) new_port=20132 ;;
    20132) new_port=20131 ;;
    *) die "invalid active slot: ${old_port}" ;;
  esac
  systemctl is-active --quiet "${SLOT_SERVICE}${old_port}.service" || die "active runtime is not active"
  old_target="$(readlink -f "${APP_ROOT}/current")"
  old_upstream="$(cat "${UPSTREAM_FILE}")"
  backup_path="$(backup_database "${release_id}")"
  log "database backup: ${backup_path}"

  release_dir="${APP_ROOT}/releases/${release_id}"
  prod_artifact="${release_dir}/.next/standalone"
  if [[ -e "${release_dir}" ]]; then
    [[ -d "${prod_artifact}" ]] || die "existing release path is invalid"
    [[ "$(artifact_hash "${prod_artifact}")" == "${expected_hash}" ]] || die "existing artifact checksum mismatch"
  else
    local temp_release="${APP_ROOT}/releases/.${release_id}.tmp.$$"
    mkdir -p "${temp_release}/.next/standalone"
    cp -a "${stage_artifact}/." "${temp_release}/.next/standalone/"
    chown -R "${APP_USER}:${APP_USER}" "${temp_release}"
    [[ "$(artifact_hash "${temp_release}/.next/standalone")" == "${expected_hash}" ]] \
      || die "copied artifact checksum mismatch"
    mv "${temp_release}" "${release_dir}"
  fi

  local switched=0 committed=0
  rollback_failed_promotion() {
    local rc=$?
    trap - ERR INT TERM EXIT
    if [[ "${committed}" -eq 0 ]]; then
      log "promotion failed; restoring previous runtime"
      if [[ "${switched}" -eq 1 ]]; then
        printf '%s\n' "${old_upstream}" >"${UPSTREAM_FILE}"
        nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
      fi
      systemctl start "${SLOT_SERVICE}${old_port}.service" || true
      systemctl stop "${SLOT_SERVICE}${new_port}.service" || true
      ln -sfn "${old_target}" "${APP_ROOT}/current"
      printf '%s\n' "${old_port}" >"${ACTIVE_STATE}"
      log "rollback complete"
    fi
    exit "${rc}"
  }
  trap rollback_failed_promotion ERR INT TERM EXIT

  ln -sfn "${prod_artifact}" "${APP_ROOT}/slots/${new_port}"
  chown -h "${APP_USER}:${APP_USER}" "${APP_ROOT}/slots/${new_port}" || true
  write_slot_env "${new_port}"
  systemctl daemon-reload
  systemctl enable --now "${SLOT_SERVICE}${new_port}.service"
  wait_healthy "${new_port}" "candidate ${release_id}" 45
  require_workers "${new_port}" "candidate ${release_id}"
  provider_smoke "${new_port}" "candidate" "${release_id}"

  switch_upstream "${new_port}"
  switched=1
  wait_healthy "${PROD_PORT}" "stable production after switch"
  require_workers "${PROD_PORT}" "stable production after switch"
  repeated_health "${PROD_PORT}" 20
  provider_smoke "${PROD_PORT}" "stable after switch" "${release_id}"
  assert_gateways
  if [[ -n "${POST_PROMOTE_CHECK:-}" ]]; then
    [[ -x "${POST_PROMOTE_CHECK}" ]] || die "POST_PROMOTE_CHECK is not executable"
    "${POST_PROMOTE_CHECK}" "${release_id}"
  fi

  sleep "${DRAIN_SECONDS:-30}"
  wait_healthy "${PROD_PORT}" "stable production after drain"
  systemctl stop "${SLOT_SERVICE}${old_port}.service"
  systemctl disable "${SLOT_SERVICE}${old_port}.service" >/dev/null 2>&1 || true
  printf '%s\n' "${old_port}" >"${PREVIOUS_STATE}"
  printf '%s\n' "${new_port}" >"${ACTIVE_STATE}"
  ln -sfn "${prod_artifact}" "${APP_ROOT}/current"
  chown -h "${APP_USER}:${APP_USER}" "${APP_ROOT}/current" || true
  assert_production
  repeated_health "${PROD_PORT}" 20
  provider_smoke "${PROD_PORT}" "stable after drain" "${release_id}"

  committed=1
  trap - ERR INT TERM EXIT
  log "PROMOTE PASS: ${release_id} is live on fixed endpoint 20128"
  log "active slot ${new_port}; rollback slot ${old_port}; backup ${backup_path}"
}

rollback_release() {
  assert_proxy_topology
  [[ -f "${PREVIOUS_STATE}" ]] || die "previous slot state is missing"
  local current previous
  current="$(tr -d '[:space:]' <"${ACTIVE_STATE}")"
  previous="$(tr -d '[:space:]' <"${PREVIOUS_STATE}")"
  [[ "${current}" =~ ^2013[12]$ && "${previous}" =~ ^2013[12]$ && "${current}" != "${previous}" ]] \
    || die "invalid rollback state"
  [[ -L "${APP_ROOT}/slots/${previous}" ]] || die "previous slot artifact is missing"
  systemctl enable --now "${SLOT_SERVICE}${previous}.service"
  wait_healthy "${previous}" "rollback candidate"
  require_workers "${previous}" "rollback candidate"
  switch_upstream "${previous}"
  wait_healthy "${PROD_PORT}" "stable production after rollback"
  repeated_health "${PROD_PORT}" 20
  assert_gateways
  sleep "${DRAIN_SECONDS:-30}"
  systemctl stop "${SLOT_SERVICE}${current}.service"
  systemctl disable "${SLOT_SERVICE}${current}.service" >/dev/null 2>&1 || true
  printf '%s\n' "${current}" >"${PREVIOUS_STATE}"
  printf '%s\n' "${previous}" >"${ACTIVE_STATE}"
  ln -sfn "$(readlink -f "${APP_ROOT}/slots/${previous}")" "${APP_ROOT}/current"
  log "ROLLBACK PASS: endpoint 20128 now uses slot ${previous}; database unchanged"
}

cleanup_release() {
  local release_id="${1:-}" manifest deployed
  [[ "${release_id}" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid release ID"
  manifest="${STAGE_ROOT}/manifests/${release_id}.json"
  deployed="${APP_ROOT}/releases/${release_id}/.next/standalone"
  [[ -f "${manifest}" && -d "${deployed}" ]] || die "release is not eligible for cleanup"
  stop_staging
  rm -rf "${STAGE_DATA}" "${STAGE_CONFIG}" \
    "${STAGE_ROOT}/builds/${release_id}" "${STAGE_ROOT}/artifacts/${release_id}"
  rm -f "${STAGE_ROOT}/approvals/${release_id}.approved" "${STAGE_ROOT}/current"
  assert_production
  log "staging cleaned for ${release_id}; manifest retained"
}

prune_releases() {
  assert_proxy_topology
  local active_port previous_port active_target prev_target
  local kept=0 removed=0

  active_port="$(tr -d '[:space:]' <"${ACTIVE_STATE}")"
  previous_port="$(tr -d '[:space:]' <"${PREVIOUS_STATE}" 2>/dev/null || true)"
  active_target="$(dirname "$(dirname "$(readlink -f "${APP_ROOT}/slots/${active_port}")")")"
  prev_target=""
  [[ -n "${previous_port}" && -L "${APP_ROOT}/slots/${previous_port}" ]] \
    && prev_target="$(dirname "$(dirname "$(readlink -f "${APP_ROOT}/slots/${previous_port}")")")"

  log "prune: keeping active slot ${active_port} and rollback slot ${previous_port}"

  local dir size
  for dir in "${APP_ROOT}/releases/"*/; do
    [[ -d "${dir}" ]] || continue
    dir="${dir%/}"
    [[ "${dir}" != "${active_target}" && "${dir}" != "${prev_target}" ]] || { kept=$((kept+1)); continue; }
    size="$(du -sh "${dir}" 2>/dev/null | awk '{print $1}')"
    rm -rf "${dir}"
    removed=$((removed+1))
    log "prune: removed ${dir##*/} (${size})"
  done

  log "prune complete: kept=${kept} removed=${removed}"
}

show_status() {
  assert_production
  health_json "${PROD_PORT}" | python3 -m json.tool
  local active
  active="$(tr -d '[:space:]' <"${ACTIVE_STATE}")"
  printf 'active_internal_slot=%s\n' "${active}"
  systemctl is-active nginx
  systemctl is-active "${SLOT_SERVICE}${active}.service"
  if systemctl is-active --quiet "${STAGE_SERVICE}"; then
    health_json "${STAGE_PORT}" | python3 -m json.tool
    require_workers "${STAGE_PORT}" "staging"
  else
    printf 'staging=inactive\n'
  fi
}

main() {
  require_vps
  for command in curl python3 tar sha256sum flock systemctl nginx ss git npm docker openssl sudo; do
    need "${command}"
  done
  acquire_lock
  case "${1:-}" in
    stage) stage_release "${2:-}" ;;
    approve) approve_release "${2:-}" "${3:-}" ;;
    promote) promote_release "${2:-}" ;;
    rollback) rollback_release ;;
    cleanup) cleanup_release "${2:-}" ;;
    prune) prune_releases ;;
    status) show_status ;;
    *) die "usage: $0 {stage <ref>|approve <release-id> <evidence>|promote <release-id>|rollback|cleanup <release-id>|prune|status}" ;;
  esac
}

main "$@"
