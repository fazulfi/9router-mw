import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  info: mocks.logInfo,
  warn: mocks.logWarn,
  error: vi.fn(),
  debug: vi.fn(),
  request: vi.fn(),
  maskKey: vi.fn(),
}));

import { reactivateExpiredKimchiAccounts } from "../../src/sse/services/kimchiQuotaReactivation.js";

const iso = (ms) => new Date(ms).toISOString();
const past = iso(Date.now() - 60_000);
const future = iso(Date.now() + 60_000);

const conn = (overrides = {}) => ({
  id: "conn-1",
  name: "Kimchi A",
  provider: "kimchi",
  isActive: false,
  testStatus: "quota_exhausted",
  rateLimitedUntil: past,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.updateProviderConnection.mockResolvedValue({});
});

describe("reactivateExpiredKimchiAccounts", () => {
  it("reactivates accounts whose rateLimitedUntil has passed", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn({ id: "c1", name: "K1", rateLimitedUntil: past }),
      conn({ id: "c2", name: "K2", rateLimitedUntil: iso(Date.now() - 86_400_000) }),
    ]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(2);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(2);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("c1", expect.objectContaining({
      isActive: true,
      rateLimitedUntil: null,
      testStatus: "active",
      quotaExhaustedAt: null,
      quotaResetsAt: null,
    }));
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("c2", expect.objectContaining({ isActive: true, testStatus: "active" }));
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("Kimchi quota reactivated"));
  });

  it("skips accounts whose rateLimitedUntil is still in the future", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn({ id: "c1", rateLimitedUntil: future }),
    ]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(0);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("skips accounts without testStatus=quota_exhausted", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn({ id: "c1", testStatus: "error", rateLimitedUntil: past }),
      conn({ id: "c2", testStatus: "manual", rateLimitedUntil: past }),
    ]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(0);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("skips accounts with no rateLimitedUntil set", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn({ id: "c1", rateLimitedUntil: null }),
    ]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(0);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("skips accounts with an invalid rateLimitedUntil timestamp", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn({ id: "c1", rateLimitedUntil: "not-a-date" }),
    ]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(0);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("continues processing when updateProviderConnection throws for one account", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn({ id: "c1", name: "K1" }),
      conn({ id: "c2", name: "K2" }),
    ]);
    mocks.updateProviderConnection
      .mockRejectedValueOnce(new Error("db locked"))
      .mockResolvedValueOnce({});

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(1);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(2);
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "AUTH",
      expect.stringContaining("Kimchi quota reactivation failed for K1")
    );
  });

  it("returns 0 and logs a warning when getProviderConnections throws", async () => {
    mocks.getProviderConnections.mockRejectedValue(new Error("db unavailable"));

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(0);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "AUTH",
      expect.stringContaining("failed to query connections")
    );
  });

  it("returns 0 when there are no kimchi connections", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(0);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("returns 0 for a null connections result", async () => {
    mocks.getProviderConnections.mockResolvedValue(null);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(0);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("handles a mix of eligible, future, and wrong-status accounts", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn({ id: "eligible", rateLimitedUntil: past }),                       // reactivate
      conn({ id: "future", rateLimitedUntil: future }),                        // skip (future)
      conn({ id: "wrong-status", testStatus: "error", rateLimitedUntil: past }), // skip (status)
      conn({ id: "no-until", rateLimitedUntil: null }),                        // skip (no until)
    ]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(1);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("eligible", expect.any(Object));
  });
});
