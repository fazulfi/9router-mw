import { describe, expect, it } from "vitest";
import appPkg from "../../package.json" with { type: "json" };
import { GITHUB_CONFIG } from "../../src/shared/constants/config.js";

describe("dashboard changelog source", () => {
  it("loads the immutable changelog for the running MW release", () => {
    expect(GITHUB_CONFIG.changelogUrl).toBe(
      `https://raw.githubusercontent.com/fazulfi/9router-mw/refs/tags/v${appPkg.version}/CHANGELOG.md`
    );
    expect(GITHUB_CONFIG.changelogUrl).not.toContain("decolua/9router");
  });
});
