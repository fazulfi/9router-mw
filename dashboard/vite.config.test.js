import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Vite production build config", () => {
  it("must disable sourcemaps (build.sourcemap === false)", async () => {
    const mod = await import("./vite.config.js");
    const config = mod.default ?? mod;

    assert.ok(config, "vite config must exist");
    assert.ok(config.build, "vite config must have build section");
    assert.equal(
      config.build.sourcemap,
      false,
      "build.sourcemap must be false to prevent production source map emission",
    );
  });
});
