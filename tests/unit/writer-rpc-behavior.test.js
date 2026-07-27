import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  shared: null,
}));

vi.mock("open-sse/services/redisClient.js", () => ({
  getRedis: vi.fn(async () => redisState.shared),
}));

function createRedisHarness() {
  const responses = [];
  let duplicateCalls = 0;
  let blockingConnectCalls = 0;
  const blocking = {
    status: "wait",
    connect: vi.fn(async () => {
      blockingConnectCalls += 1;
      blocking.status = "ready";
    }),
    blpop: vi.fn(async () => {
      const response = responses.shift();
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return null;
    }),
  };
  const shared = {
    rpush: vi.fn(async (_key, payload) => {
      const request = JSON.parse(payload);
      responses.push([
        request.responseKey,
        JSON.stringify({ correlationId: request.correlationId, ok: true, result: { saved: request.command } }),
      ]);
      return 1;
    }),
    duplicate: vi.fn(() => {
      duplicateCalls += 1;
      return blocking;
    }),
  };
  return {
    shared,
    blocking,
    get duplicateCalls() {
      return duplicateCalls;
    },
    get blockingConnectCalls() {
      return blockingConnectCalls;
    },
  };
}

describe("writer RPC behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MW_WORKER_ID = "7";
    process.env.MW_WRITER_MODE = "1";
    process.env.MW_RUNTIME_NAMESPACE = "test-slot";
    delete process.env.MW_WRITER_PROCESS;
  });

  afterEach(() => {
    redisState.shared = null;
    delete process.env.MW_WORKER_ID;
    delete process.env.MW_WRITER_MODE;
    delete process.env.MW_RUNTIME_NAMESPACE;
    delete process.env.MW_WRITER_PROCESS;
    vi.restoreAllMocks();
  });

  it("correlates a writer response using a dedicated blocking Redis client", async () => {
    const harness = createRedisHarness();
    redisState.shared = harness.shared;
    const { executeWriterCommand } = await import("../../src/lib/db/writerRpc.js");

    await expect(executeWriterCommand("updateSettings", [{ theme: "dark" }])).resolves.toEqual({
      saved: "updateSettings",
    });
    expect(harness.duplicateCalls).toBe(1);
    expect(harness.blockingConnectCalls).toBe(1);
    expect(harness.shared.rpush).toHaveBeenCalledTimes(1);
    expect(harness.blocking.blpop).toHaveBeenCalledWith("mw:test-slot:write:responses:7", 1);
  });

  it("rejects instead of writing directly when Redis is unavailable", async () => {
    redisState.shared = null;
    const { executeWriterCommand } = await import("../../src/lib/db/writerRpc.js");

    await expect(executeWriterCommand("updateSettings", [{}])).rejects.toThrow(
      "writer RPC Redis unavailable"
    );
  });

  it("rejects unknown writer commands before repository dispatch", async () => {
    const { executeWriterCommandLocally } = await import("../../src/lib/db/writerCommands.js");

    await expect(executeWriterCommandLocally("rawSql", ["DELETE FROM settings"])).rejects.toThrow(
      "unknown writer command"
    );
  });
});
