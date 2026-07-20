import { describe, it, expect } from "vitest";
import { projectUsageStats } from "../../src/lib/mw/deps.js";

// The real getUsageStats() in usageRepo.js returns totalPromptTokens and
// totalCompletionTokens (not totalTokens).  projectUsageStats must derive
// totalTokens from their sum.  The current implementation reads
// source.totalTokens directly, which is absent → always 0.
//
// These tests enforce the missing derivation.  They MUST fail (RED) against
// the current code.  All test inputs are sanitized — no real row data.

describe("projectUsageStats — token projection (RED)", () => {
  it("RED: derives totalTokens from totalPromptTokens + totalCompletionTokens", () => {
    const raw = {
      totalRequests: 10,
      totalPromptTokens: 250,
      totalCompletionTokens: 75,
    };
    const result = projectUsageStats(raw, "24h");

    // Expected: 250 + 75 = 325
    // Actual (current): Number(undefined) || 0 → 0
    expect(result.totalTokens).toBe(325);
  });

  it("RED: derives totalTokens with only prompt tokens present (completion absent = 0)", () => {
    const raw = {
      totalRequests: 5,
      totalPromptTokens: 100,
      // totalCompletionTokens absent — treat as 0
    };
    const result = projectUsageStats(raw, "24h");

    // Expected: 100 + 0 = 100
    // Actual (current): Number(undefined) || 0 → 0
    expect(result.totalTokens).toBe(100);
  });

  it("RED: derives totalTokens with only completion tokens present (prompt absent = 0)", () => {
    const raw = {
      totalRequests: 4,
      // totalPromptTokens absent — treat as 0
      totalCompletionTokens: 40,
    };
    const result = projectUsageStats(raw, "7d");

    // Expected: 0 + 40 = 40
    // Actual (current): Number(undefined) || 0 → 0
    expect(result.totalTokens).toBe(40);
  });

  it("RED: derives totalTokens for 30d period with non-trivial sums", () => {
    const raw = {
      totalRequests: 100,
      totalPromptTokens: 12_345,
      totalCompletionTokens: 6_789,
    };
    const result = projectUsageStats(raw, "30d");

    // Expected: 12345 + 6789 = 19134
    // Actual (current): Number(undefined) || 0 → 0
    expect(result.totalTokens).toBe(19_134);
    expect(result.period).toBe("30d");
    expect(result.totalRequests).toBe(100);
  });
});
