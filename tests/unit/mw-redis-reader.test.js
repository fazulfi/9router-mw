import { describe, expect, it, vi } from "vitest";

import {
  readRedisLiveSnapshot,
  projectLiveSnapshot,
} from "../../src/lib/mw/readModel/redisReader.js";

function redisStub(overrides = {}) {
  return {
    scan: vi.fn(async function* () {
      yield ["0", []];
    }),
    lrange: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("MW Redis read-model contracts", () => {
  it("uses only allowlisted bounded Redis reads", async () => {
    const redis = redisStub({
      scan: vi.fn(async function* (cursor, options) {
        expect(cursor).toBe("0");
        expect(options).toMatchObject({ MATCH: "mw:live:cnt:*", COUNT: 25 });
        yield ["0", ["mw:live:cnt:account-a|model-a"]];
      }),
      get: vi.fn().mockResolvedValue("3"),
      lrange: vi.fn().mockResolvedValue([]),
    });

    await readRedisLiveSnapshot(redis, { scanCount: 25, maxCounterKeys: 50, recentLimit: 50 });

    expect(redis).not.toHaveProperty("keys");
    expect(redis).not.toHaveProperty("smembers");
    expect(redis.scan).toHaveBeenCalled();
    expect(redis.lrange).toHaveBeenCalledWith("mw:live:recent", 0, 49);
    expect(redis.lrange.mock.calls[0][2]).toBe(49);
  });

  it("rejects unbounded scan and recent-list budgets", async () => {
    const redis = redisStub();

    await expect(
      readRedisLiveSnapshot(redis, { scanCount: 0, maxCounterKeys: 0, recentLimit: 0 }),
    ).rejects.toThrow(/bound|limit|budget/i);
  });

  it("returns an allowlisted DTO and strips apiKey and credential-shaped fields", () => {
    const dto = projectLiveSnapshot({
      mode: "redis",
      active: [{ connectionId: "account-a", model: "model-a", count: 2, apiKey: "[REDACTED]" }],
      recent: [{
        timestamp: "2026-01-01T00:00:00.000Z",
        provider: "provider-a",
        model: "model-a",
        connectionId: "account-a",
        apiKey: "[REDACTED]",
        accessToken: "[REDACTED]",
        credential: { token: "[REDACTED]" },
        endpoint: "https://sanitized.invalid/v1",
        status: "ok",
        tokens: { input: 10, output: 20 },
      }],
      lastError: "provider-a",
      internalSecret: "[REDACTED]",
    });

    expect(dto).toEqual({
      mode: "redis",
      active: [{ connectionId: "account-a", model: "model-a", count: 2 }],
      recent: [{
        timestamp: "2026-01-01T00:00:00.000Z",
        provider: "provider-a",
        model: "model-a",
        connectionId: "account-a",
        endpoint: "https://sanitized.invalid/v1",
        status: "ok",
        tokens: { input: 10, output: 20 },
      }],
      lastError: "provider-a",
    });
    expect(JSON.stringify(dto)).not.toMatch(/apiKey|accessToken|credential|internalSecret|REDACTED/i);
  });

  it("degrades malformed recent JSON without returning the raw payload", async () => {
    const redis = redisStub({
      lrange: vi.fn().mockResolvedValue([
        '{"provider":"provider-a","model":"model-a"}',
        '{"apiKey":"[REDACTED]", malformed',
      ]),
    });

    const snapshot = await readRedisLiveSnapshot(redis, { recentLimit: 2, scanCount: 25, maxCounterKeys: 50 });

    expect(snapshot.mode).toBe("degraded");
    expect(snapshot.recent).toEqual([
      { provider: "provider-a", model: "model-a" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("malformed");
    expect(JSON.stringify(snapshot)).not.toContain("apiKey");
  });
});
