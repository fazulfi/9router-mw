import { describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";

const file = new URL("../../src/app/api/usage/stream/route.js", import.meta.url);
const expectedSha256 = "65686687f27d2a74a24ccec35f562cc6038802a0c694fad44620fdb92be1d932";

describe("legacy usage stream immutability", () => {
  it("keeps the legacy SSE exports and stable data-source markers", () => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("export async function GET");
    expect(content).toContain("statsEmitter");
    expect(content).toContain("getUsageStats");
    expect(crypto.createHash("sha256").update(content).digest("hex")).toBe(expectedSha256);
  });
});
