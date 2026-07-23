import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appPkg from "../../package.json" with { type: "json" };
import cliPkg from "../../cli/package.json" with { type: "json" };

const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const versionMarker = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();

describe("MW release version", () => {
  it("keeps every release version surface aligned", () => {
    expect(cliPkg.version).toBe(appPkg.version);
    expect(versionMarker).toBe(appPkg.version);
    expect(changelog).toMatch(new RegExp(`^# v${appPkg.version.replaceAll(".", "\\.")}\\b`));
  });
});
