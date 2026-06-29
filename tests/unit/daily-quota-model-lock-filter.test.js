// Verify getProviderCredentials respects modelLock_${model} set by daily quota detection.
// A connection locked for model A must be skipped when model A is requested,
// but still usable for model B.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProviderConnections = vi.fn();
const updateProviderConnection = vi.fn();
const getSettings = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  updateProviderConnection,
  validateApiKey: vi.fn(),
  getSettings,
  getProviderNodeById: vi.fn(),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

function makeConnection(id, overrides = {}) {
  const tomorrowMidnight = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate() + 1,
    0, 0, 0, 0
  )).toISOString();
  return {
    id,
    name: `conn-${id}`,
    providerSpecificData: {},
    isActive: true,
    testStatus: "active",
    priority: 1,
    [`modelLock_gpt-4o`]: overrides.gpt4oLocked ? tomorrowMidnight : undefined,
    [`modelLock_gpt-3.5-turbo`]: overrides.gpt35Locked ? tomorrowMidnight : undefined,
  };
}

describe("daily quota model-lock end-to-end filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({});
  });

  it("reports allRateLimited when the only connection is locked for the model", async () => {
    const lockedConn = makeConnection("locked", { gpt4oLocked: true });
    getProviderConnections.mockResolvedValue([lockedConn]);

    const result = await getProviderCredentials("openai", null, "gpt-4o");

    expect(result).toMatchObject({ allRateLimited: true, connectionId: "locked" });
    expect(result.retryAfter).toBeDefined();
    expect(getProviderConnections).toHaveBeenCalledWith({ provider: "openai", isActive: true });
  });

  it("uses the same connection for a model that is not locked", async () => {
    const lockedConn = makeConnection("locked", { gpt4oLocked: true });
    getProviderConnections.mockResolvedValue([lockedConn]);

    const result = await getProviderCredentials("openai", null, "gpt-3.5-turbo");

    expect(result).not.toBeNull();
    expect(result.connectionId).toBe("locked");
  });

  it("picks the next available connection when the first is locked for the model", async () => {
    const lockedConn = makeConnection("locked", { gpt4oLocked: true });
    const freeConn = makeConnection("free");
    getProviderConnections.mockResolvedValue([lockedConn, freeConn]);

    const result = await getProviderCredentials("openai", null, "gpt-4o");

    expect(result).not.toBeNull();
    expect(result.connectionId).toBe("free");
  });

  it("reports allRateLimited when every connection is locked for the requested model", async () => {
    const conn1 = makeConnection("c1", { gpt4oLocked: true });
    const conn2 = makeConnection("c2", { gpt4oLocked: true });
    getProviderConnections.mockResolvedValue([conn1, conn2]);

    const result = await getProviderCredentials("openai", null, "gpt-4o");

    expect(result).toMatchObject({
      allRateLimited: true,
      connectionId: "c1", // earliest lock
    });
    expect(result.retryAfter).toBeDefined();
  });

  it("ignores an expired lock and uses the connection", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const conn = {
      ...makeConnection("expired"),
      modelLock_gpt_4o: yesterday,
    };
    getProviderConnections.mockResolvedValue([conn]);

    const result = await getProviderCredentials("openai", null, "gpt-4o");

    expect(result).not.toBeNull();
    expect(result.connectionId).toBe("expired");
  });
});
