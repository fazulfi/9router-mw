import { describe, expect, it, vi } from "vitest";
import {
  MW_API_ROOT,
  USAGE_PERIODS,
  buildApiPath,
  buildStreamUrl,
  isAllowedUsagePeriod,
  isDegradedPayload,
  isEmptyPayload,
  mapResponseStatus,
  mwGet,
  projectResource,
} from "../../dashboard/src/lib/api.js";

describe("mw-spa api path builders", () => {
  it("uses fixed /mw/api/v1 root", () => {
    expect(MW_API_ROOT).toBe("/mw/api/v1");
  });

  it("builds resource paths without double slashes", () => {
    expect(buildApiPath("overview")).toBe("/mw/api/v1/overview");
    expect(buildApiPath("/providers/")).toBe("/mw/api/v1/providers");
  });

  it("appends allowlisted query params", () => {
    expect(buildApiPath("usage", { period: "7d" })).toBe(
      "/mw/api/v1/usage?period=7d",
    );
    expect(buildApiPath("usage", { period: "24h", empty: "" })).toBe(
      "/mw/api/v1/usage?period=24h",
    );
  });

  it("stream URL is only /mw/api/v1/stream", () => {
    expect(buildStreamUrl()).toBe("/mw/api/v1/stream");
    expect(buildStreamUrl()).not.toContain("/api/usage/stream");
  });

  it("rejects path traversal and legacy api prefixes", () => {
    expect(() => buildApiPath("../secret")).toThrow(/Invalid API resource/);
    expect(() => buildApiPath("api/usage/stream")).toThrow(
      /Only \/mw\/api\/v1/,
    );
    expect(() => buildApiPath("api/health")).toThrow(/Only \/mw\/api\/v1/);
  });

  it("allowlists usage periods", () => {
    expect(USAGE_PERIODS).toEqual(["24h", "7d", "30d"]);
    expect(isAllowedUsagePeriod("24h")).toBe(true);
    expect(isAllowedUsagePeriod("1h")).toBe(false);
  });
});

describe("mw-spa response status mapping", () => {
  it("maps 401 to unauthenticated with sign-in guidance", () => {
    const mapped = mapResponseStatus(401);
    expect(mapped.kind).toBe("unauthenticated");
    expect(mapped.message).toMatch(/main .*dashboard/i);
    expect(mapped.message).toMatch(/sign in/i);
    expect(mapped.message).not.toMatch(/\bpassword\b/i);
  });

  it("maps 500 with generic failure", () => {
    const mapped = mapResponseStatus(500, { error: "Failed to load" });
    expect(mapped.kind).toBe("error");
    expect(mapped.message).toBe("Failed to load");
  });

  it("maps 200 as ok", () => {
    expect(mapResponseStatus(200).kind).toBe("ok");
  });
});

describe("mw-spa empty and degraded detection", () => {
  it("detects empty providers", () => {
    expect(isEmptyPayload("providers", { providers: [] })).toBe(true);
    expect(
      isEmptyPayload("providers", { providers: [{ provider: "openai" }] }),
    ).toBe(false);
  });

  it("detects degraded workers", () => {
    expect(
      isDegradedPayload("workers", { availability: "unavailable" }),
    ).toBe(true);
    expect(isDegradedPayload("workers", { availability: "degraded" })).toBe(
      true,
    );
  });

  it("detects empty usage aggregates", () => {
    expect(
      isEmptyPayload("usage", {
        period: "24h",
        totalRequests: 0,
        totalTokens: 0,
        successCount: 0,
        errorCount: 0,
      }),
    ).toBe(true);
  });
});

describe("mw-spa projectResource", () => {
  it("projects overview safely", () => {
    const dto = projectResource("overview", {
      redis: {
        mode: "redis",
        activeCount: 2,
        recentCount: 3,
        lastError: null,
        apiKey: "SECRET",
      },
      workers: { availability: "unavailable", password: "x" },
    });
    expect(dto.redis.mode).toBe("redis");
    expect(dto.redis.activeCount).toBe(2);
    expect(dto.workers.availability).toBe("unavailable");
    expect(JSON.stringify(dto)).not.toMatch(
      /apiKey|password|accessToken|credential|internalSecret/i,
    );
  });

  it("projects workers without inventing metrics", () => {
    const dto = projectResource("workers", {
      availability: "degraded",
      schemaVersion: 1,
      pid: 12345,
      host: "10.0.0.1",
    });
    expect(dto.availability).toBe("degraded");
    expect(dto.schemaVersion).toBe(1);
    expect(dto.pid).toBeUndefined();
    expect(dto.host).toBeUndefined();
  });
});

describe("mw-spa mwGet", () => {
  it("calls same-origin path with credentials include", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        period: "24h",
        totalRequests: 1,
        totalTokens: 10,
        successCount: 1,
        errorCount: 0,
        apiKey: "should-strip",
      }),
    }));

    const result = await mwGet("usage", {
      query: { period: "24h" },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/mw/api/v1/usage?period=24h",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.totalRequests).toBe(1);
    expect(JSON.stringify(result.data)).not.toContain("apiKey");
    expect(JSON.stringify(result.data)).not.toContain("should-strip");
  });

  it("returns unauthenticated on 401", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "Unauthorized" }),
    }));

    const result = await mwGet("overview", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("unauthenticated");
    expect(result.data).toBeNull();
  });

  it("returns error kind on network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await mwGet("health", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("error");
    expect(result.message).toMatch(/network/i);
  });
});
