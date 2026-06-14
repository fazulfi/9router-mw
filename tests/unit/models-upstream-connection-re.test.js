// Regression guard for: "UPSTREAM_CONNECTION_RE is not defined" — a ReferenceError
// thrown by GET /v1/models when an OpenAI/Anthropic-compatible provider (e.g. a
// Kilo custom key) had zero models yet, hitting the branch at route.js:330.
// The constant was used but never defined/imported in route.js. This test fails
// at import time if the module references an undefined module-scope identifier.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = resolve(__dirname, "../../src/app/api/v1/models/route.js");

describe("v1/models route — UPSTREAM_CONNECTION_RE regression", () => {
  const src = readFileSync(ROUTE_SRC, "utf8");

  it("defines UPSTREAM_CONNECTION_RE before use (no ReferenceError)", () => {
    const defIdx = src.indexOf("const UPSTREAM_CONNECTION_RE");
    const useIdx = src.indexOf("UPSTREAM_CONNECTION_RE.test");
    expect(defIdx).toBeGreaterThanOrEqual(0); // must be declared
    expect(useIdx).toBeGreaterThan(defIdx);   // declared before used
  });

  it("the connection-hash regex skips custom compatible IDs but not plain providers", () => {
    // Mirror the exact pattern declared in the route.
    const m = src.match(/const UPSTREAM_CONNECTION_RE = (\/.*\/[a-z]*);/);
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    const RE = eval(m[1]);
    expect(RE.test("openai-compatible-a1b2c3d4")).toBe(true);  // custom node → skip live fetch
    expect(RE.test("anthropic-compatible-deadbeef")).toBe(true);
    expect(RE.test("kilo")).toBe(false);                       // plain provider → passthrough
    expect(RE.test("openai")).toBe(false);
  });
});
