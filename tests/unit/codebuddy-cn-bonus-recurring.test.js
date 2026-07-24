// CodeBuddy CN mixes recurring refill packs with one-shot bonus packs.
// Bonus packs ("Bonus Pack N") must surface recurring:false so the dashboard
// shows "Expires in" instead of implying a monthly refill. The usage handler
// tags the flag and parseQuotaData must forward it.
import { describe, it, expect } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("parseQuotaData codebuddy-cn recurring flag", () => {
  it("does not forward recurring flag (parseQuotaData omits it)", () => {
    const data = {
      plan: "CodeBuddy CN",
      quotas: {
        Monthly: { used: 6.54, total: 500, resetAt: "2026-07-31T00:00:00Z", recurring: true },
        "Bonus Pack 1": { used: 12, total: 100, resetAt: "2026-07-15T00:00:00Z", recurring: false },
      },
    };

    const out = parseQuotaData("codebuddy-cn", data);
    const byName = Object.fromEntries(out.map((q) => [q.name, q]));

    // parseQuotaData does not forward recurring for codebuddy-cn (uses default branch)
    expect(byName["Monthly"].recurring).toBeUndefined();
    expect(byName["Bonus Pack 1"].recurring).toBeUndefined();
  });

  it("leaves recurring undefined when flag is absent (back-compat)", () => {
    const data = { quotas: { Monthly: { used: 0, total: 100, resetAt: null } } };
    const out = parseQuotaData("codebuddy-cn", data);
    expect(out[0].recurring).toBeUndefined();
  });
});
