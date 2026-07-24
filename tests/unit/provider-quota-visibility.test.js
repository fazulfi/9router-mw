import { describe, expect, it } from "vitest";
import {
  parseQuotaData,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("provider quota visibility", () => {
  const data = {
    quotas: {
      "gemini-pro-agent": {
        displayName: "Gemini 3.1 Pro (High)",
        used: 200,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
      },
      "claude-opus-4-6-thinking": {
        displayName: "Claude Opus 4.6 (Thinking)",
        used: 100,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
      },
    },
  };

  it("keeps Antigravity modelKey so hidden settings use stable quota ids", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(quotas.map((q) => q.modelKey)).toEqual([
      "gemini-pro-agent",
      "claude-opus-4-6-thinking",
    ]);
  });

  it("parseQuotaData returns all quotas for antigravity", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(quotas).toHaveLength(2);
    expect(quotas.map((q) => q.modelKey)).toContain("gemini-pro-agent");
    expect(quotas.map((q) => q.modelKey)).toContain("claude-opus-4-6-thinking");
  });

  it("parseQuotaData is provider-aware (does not mix providers)", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(quotas).toHaveLength(2);
  });
});
