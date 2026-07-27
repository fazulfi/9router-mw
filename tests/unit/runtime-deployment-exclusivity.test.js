import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtimeRelease = readFileSync(
  new URL("../../docs/runtime-deployment/runtime-release.sh", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const bootstrap = readFileSync(
  new URL("../../docs/runtime-deployment/bootstrap-fixed-runtime-proxy.sh", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("runtime deployment exclusivity", () => {
  it("rejects a steady state with the legacy service or standby slot active", () => {
    expect(runtimeRelease).toContain('LEGACY_SERVICE="9router-mw.service"');
    const steadyState = section(
      runtimeRelease,
      "assert_steady_state_runtime() {",
      "\n}\n\nassert_proxy_topology() {",
    );

    expect(steadyState).toContain("assert_legacy_service_retired");
    expect(runtimeRelease).toContain(
      '[[ "${state}" == "masked" || "${state}" == "not-found" ]]',
    );
    expect(steadyState).toContain(
      'systemctl is-active --quiet "${SLOT_SERVICE}${active_port}.service"',
    );
    expect(steadyState).toContain(
      'systemctl is-active --quiet "${SLOT_SERVICE}${standby_port}.service"',
    );
  });

  it("runs transition preflight before mutating promotion or rollback slots", () => {
    const promote = section(runtimeRelease, "promote_release() {", "\n}\n\nrollback_release() {");
    const rollback = section(runtimeRelease, "rollback_release() {", "\n}\n\ncleanup_release() {");

    expect(runtimeRelease).toContain('[[ "${refuse_stop}" != "yes" ]]');
    expect(runtimeRelease).toContain('assert_unit_stoppable "${SLOT_SERVICE}${active_port}.service"');
    expect(runtimeRelease).toContain('assert_unit_startable "${SLOT_SERVICE}${active_port}.service"');
    expect(runtimeRelease).toContain('assert_unit_stoppable "${SLOT_SERVICE}${candidate_port}.service"');
    expect(promote.indexOf('assert_transition_ready "${old_port}" "${new_port}"')).toBeGreaterThanOrEqual(0);
    expect(promote.indexOf('assert_transition_ready "${old_port}" "${new_port}"')).toBeLessThan(
      promote.indexOf('ln -sfn "${prod_artifact}" "${APP_ROOT}/slots/${new_port}"'),
    );
    expect(rollback.indexOf('assert_transition_ready "${current}" "${previous}"')).toBeGreaterThanOrEqual(0);
    expect(rollback.indexOf('assert_transition_ready "${current}" "${previous}"')).toBeLessThan(
      rollback.indexOf('systemctl enable --now "${SLOT_SERVICE}${previous}.service"'),
    );
    expect(promote).toContain('systemctl stop "${SLOT_SERVICE}${new_port}.service"');
    expect(promote).toContain('systemctl disable "${SLOT_SERVICE}${new_port}.service"');
    expect(rollback).toContain("rollback_failed_rollback() {");
    expect(rollback.indexOf("trap rollback_failed_rollback ERR INT TERM EXIT")).toBeLessThan(
      rollback.indexOf('systemctl enable --now "${SLOT_SERVICE}${previous}.service"'),
    );
    expect(rollback).toContain('systemctl stop "${SLOT_SERVICE}${previous}.service"');
    expect(rollback).toContain('systemctl disable "${SLOT_SERVICE}${previous}.service"');
  });

  it("verifies steady-state exclusivity after promotion and rollback", () => {
    const promote = section(runtimeRelease, "promote_release() {", "\n}\n\nrollback_release() {");
    const rollback = section(runtimeRelease, "rollback_release() {", "\n}\n\ncleanup_release() {");

    expect(promote.lastIndexOf("assert_production")).toBeGreaterThan(
      promote.indexOf("systemctl disable \"${SLOT_SERVICE}${old_port}.service\""),
    );
    expect(rollback.lastIndexOf("assert_production")).toBeGreaterThan(
      rollback.indexOf("systemctl disable \"${SLOT_SERVICE}${current}.service\""),
    );
  });

  it("requires reboot-safe slot enablement in steady state", () => {
    const runtimeSteadyState = section(
      runtimeRelease,
      "assert_steady_state_runtime() {",
      "\n}\n\nassert_proxy_topology() {",
    );
    const bootstrapSteadyState = section(
      bootstrap,
      "assert_steady_state_runtime() {",
      "\n}\n\nassert_private_slots_inactive() {",
    );

    for (const steadyState of [runtimeSteadyState, bootstrapSteadyState]) {
      expect(steadyState).toContain('active_state="$(systemctl is-enabled');
      expect(steadyState).toContain('[[ "${active_state}" == "enabled" ]]');
      expect(steadyState).toContain('standby_state="$(systemctl is-enabled');
      expect(steadyState).toContain(
        '[[ "${standby_state}" == "disabled" || "${standby_state}" == "masked" || "${standby_state}" == "not-found" ]]',
      );
    }
    expect(bootstrap).toContain("reconcile_slot_enablement() {");
    expect(bootstrap).toContain('systemctl enable "9router-mw-slot@${active_port}.service"');
    expect(bootstrap).toContain('if [[ "${standby_state}" == "enabled" ]]; then');
    expect(bootstrap).toContain('systemctl disable "9router-mw-slot@${standby_port}.service"');
    expect(bootstrap.match(/reconcile_slot_enablement/g)).toHaveLength(3);
  });

  it("assembles writer dependencies without nesting the DB directory", () => {
    const assemble = section(runtimeRelease, "assemble_artifact() {", "\n}\n\nwrite_staging_unit() {");

    expect(assemble).toContain('rm -rf "${artifact}/src/lib/db"');
    expect(assemble).toContain('cp -a "${source}/src/lib/db/." "${artifact}/src/lib/db/"');
    expect(assemble).not.toContain('cp -a "${source}/src/lib/db" "${artifact}/src/lib/db/"');
  });

  it("accepts four live workers without assuming cluster IDs reset to 1-4", () => {
    for (const source of [runtimeRelease, bootstrap]) {
      expect(source).toContain("unique_worker_count");
      expect(source).toContain("grep -E '^[1-9][0-9]*$'");
      expect(source).toContain("if (( request % 16 == 0 )); then");
      expect(source).not.toContain('[[ "${seen}" == "1 2 3 4 " ]]');
    }
  });

  it("checks legacy retirement when bootstrap is already complete and after migration", () => {
    expect(bootstrap).toContain('LEGACY_SERVICE="9router-mw.service"');
    const completedPath = section(
      bootstrap,
      'if [[ -f "${LOCAL_PROXY_CONFIG}" ]]',
      "\nfi\n\nwait_healthy",
    );

    expect(completedPath).toContain("retire_legacy_services");
    expect(completedPath).toContain("assert_steady_state_runtime");
    expect(bootstrap.match(/assert_steady_state_runtime/g)).toHaveLength(3);
    expect(bootstrap).toContain('systemctl mask "${unit}"');
    expect(bootstrap).toContain(
      '[[ "${state}" == "masked" || "${state}" == "not-found" ]]',
    );
    expect(bootstrap).toContain('systemctl disable "${OLD_SERVICE}"');
  });
});
