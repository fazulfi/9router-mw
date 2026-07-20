import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  redisSnapshot: vi.fn(),
  workerObservability: vi.fn(),
  providerSummary: vi.fn(),
  usageStats: vi.fn(),
  getRedis: vi.fn(),
  openReadOnlySqlite: vi.fn(),
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verify,
}));

vi.mock("@/lib/mw/readModel/redisReader", () => ({
  readRedisLiveSnapshot: mocks.redisSnapshot,
}));

vi.mock("@/lib/mw/readModel/workerReader", () => ({
  readWorkerObservability: mocks.workerObservability,
}));

vi.mock("@/lib/mw/readModel/sqliteReader", () => ({
  readProviderSummary: mocks.providerSummary,
}));

vi.mock("@/lib/mw/deps", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMwRedis: mocks.getRedis,
    getMwUsageStats: mocks.usageStats,
    getMwReadOnlySqlite: mocks.openReadOnlySqlite,
  };
});

const health = await import("../../src/app/mw/api/v1/health/route.js");
const overview = await import("../../src/app/mw/api/v1/overview/route.js");
const providers = await import("../../src/app/mw/api/v1/providers/route.js");
const redis = await import("../../src/app/mw/api/v1/redis/route.js");
const workers = await import("../../src/app/mw/api/v1/workers/route.js");
const usage = await import("../../src/app/mw/api/v1/usage/route.js");

const routes = { health, overview, providers, redis, workers, usage };
const routePaths = Object.keys(routes);

function request(path = "http://localhost/mw/api/v1/health") {
  return {
    url: path,
    cookies: { get: vi.fn(() => ({ value: "valid" })) },
  };
}

async function json(response) {
  return response.json();
}

describe("protected MW GET routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue(true);
    mocks.getRedis.mockResolvedValue(null);
    mocks.redisSnapshot.mockResolvedValue({
      mode: "redis",
      active: [],
      recent: [],
      lastError: null,
    });
    mocks.workerObservability.mockResolvedValue({ availability: "unavailable" });
    mocks.openReadOnlySqlite.mockResolvedValue(null);
    mocks.providerSummary.mockResolvedValue([]);
    mocks.usageStats.mockResolvedValue({
      period: "24h",
      totalRequests: 0,
      totalTokens: 0,
      successCount: 0,
      errorCount: 0,
    });
  });

  it.each(routePaths)("%s rejects missing JWT with exactly generic 401", async (name) => {
    mocks.verify.mockResolvedValue(false);
    const response = await routes[name].GET({
      url: request().url,
      cookies: { get: () => undefined },
    });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "Unauthorized" });
  });

  it("exports only GET and dynamic", () => {
    for (const route of Object.values(routes)) {
      expect(route.dynamic).toBe("force-dynamic");
      const fnKeys = Object.keys(route).filter((key) => typeof route[key] === "function");
      expect(fnKeys).toContain("GET");
      expect(fnKeys).not.toContain("POST");
      expect(fnKeys).not.toContain("PUT");
      expect(fnKeys).not.toContain("PATCH");
      expect(fnKeys).not.toContain("DELETE");
    }
  });

  it("returns safe overview with injected redis and unavailable workers", async () => {
    mocks.getRedis.mockResolvedValue({});
    mocks.redisSnapshot.mockResolvedValue({
      mode: "redis",
      active: [{ connectionId: "a", model: "m", count: 1, apiKey: "secret" }],
      recent: [],
      lastError: null,
    });
    mocks.workerObservability.mockResolvedValue({ availability: "unavailable" });

    const body = await json(await routes.overview.GET(request()));
    expect(body.workers).toEqual({ availability: "unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/apiKey|accessToken|credential|password|secret/i);
  });

  it("returns degraded redis DTO when redis is unavailable", async () => {
    mocks.getRedis.mockResolvedValue(null);
    const body = await json(await routes.redis.GET(request()));
    expect(body.mode).toBe("degraded");
    expect(body).not.toHaveProperty("errorDetails");
  });

  it("uses strict read-only provider adapter and allowlisted usage period", async () => {
    mocks.openReadOnlySqlite.mockResolvedValue({ readOnly: true });
    mocks.providerSummary.mockResolvedValue([
      { provider: "openai", connectionCount: 1, enabledCount: 1, lastUsedAt: null },
    ]);
    mocks.usageStats.mockResolvedValue({
      totalRequests: 3,
      totalTokens: 7,
      apiKey: "secret",
      successCount: 2,
      errorCount: 1,
    });

    const providersBody = await json(await routes.providers.GET(request()));
    expect(providersBody.providers[0].provider).toBe("openai");

    const usageBody = await json(
      await routes.usage.GET(request("http://localhost/mw/api/v1/usage?period=7d")),
    );
    expect(usageBody.period).toBe("7d");
    expect(JSON.stringify(usageBody)).not.toContain("apiKey");
    expect(mocks.usageStats).toHaveBeenCalledWith("7d");
  });

  it("health returns ok with degraded flags and no secrets", async () => {
    mocks.getRedis.mockResolvedValue(null);
    mocks.workerObservability.mockResolvedValue({ availability: "unavailable" });
    const body = await json(await routes.health.GET(request()));
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/apiKey|password|JWT_SECRET/i);
  });
});