import { describe, expect, it } from "vitest";
import {
  containsSecretMarkers,
  isSecretKey,
  pickAllowlisted,
  sanitizeOverviewDto,
  sanitizeProvidersDto,
  sanitizeRedisSnapshot,
  sanitizeUsageDto,
  sanitizeWorkersDto,
  stripSecrets,
} from "../../dashboard/src/lib/sanitize.js";
import {
  formatCount,
  formatLastError,
  mapPageViewState,
  mapRedisMode,
  mapWorkerAvailability,
} from "../../dashboard/src/lib/state.js";

describe("mw-spa secret key detection", () => {
  it("flags exact and common secret key names", () => {
    expect(isSecretKey("apiKey")).toBe(true);
    expect(isSecretKey("accessToken")).toBe(true);
    expect(isSecretKey("credential")).toBe(true);
    expect(isSecretKey("password")).toBe(true);
    expect(isSecretKey("internalSecret")).toBe(true);
    expect(isSecretKey("API_KEY")).toBe(true);
    expect(isSecretKey("provider")).toBe(false);
    expect(isSecretKey("model")).toBe(false);
  });
});

describe("mw-spa stripSecrets hostile fixtures", () => {
  const hostile = {
    mode: "redis",
    apiKey: "sk-live-SHOULD-NOT-RENDER",
    accessToken: "tok-SHOULD-NOT-RENDER",
    credential: { password: "p@ss" },
    password: "hunter2",
    internalSecret: "cluster-secret",
    nested: {
      provider: "openai",
      apiKey: "nested-key",
      model: "gpt-4o",
    },
    active: [
      {
        connectionId: "c1",
        model: "m1",
        count: 2,
        apiKey: "row-key",
        accessToken: "row-tok",
      },
    ],
    recent: [
      {
        timestamp: "2026-07-20T00:00:00Z",
        provider: "openai",
        model: "gpt",
        connectionId: "c1",
        endpoint: "/v1/chat",
        status: "ok",
        tokens: 12,
        password: "nope",
        credential: "nope",
      },
    ],
    lastError: null,
  };

  it("removes secret keys at all depths", () => {
    const cleaned = stripSecrets(hostile);
    expect(cleaned.mode).toBe("redis");
    expect(cleaned.nested.provider).toBe("openai");
    expect(cleaned.nested.model).toBe("gpt-4o");
    expect(cleaned.apiKey).toBeUndefined();
    expect(cleaned.accessToken).toBeUndefined();
    expect(cleaned.credential).toBeUndefined();
    expect(cleaned.password).toBeUndefined();
    expect(cleaned.internalSecret).toBeUndefined();
    expect(cleaned.nested.apiKey).toBeUndefined();
    expect(JSON.stringify(cleaned)).not.toMatch(
      /apiKey|accessToken|credential|password|internalSecret/i,
    );
    expect(JSON.stringify(cleaned)).not.toContain("sk-live-SHOULD-NOT-RENDER");
    expect(JSON.stringify(cleaned)).not.toContain("tok-SHOULD-NOT-RENDER");
    expect(JSON.stringify(cleaned)).not.toContain("hunter2");
    expect(JSON.stringify(cleaned)).not.toContain("cluster-secret");
  });

  it("sanitizeRedisSnapshot only keeps allowlisted row fields", () => {
    const snap = sanitizeRedisSnapshot(hostile);
    expect(snap.mode).toBe("redis");
    expect(snap.active).toHaveLength(1);
    expect(snap.active[0]).toEqual({
      connectionId: "c1",
      model: "m1",
      count: 2,
    });
    expect(snap.recent[0]).toEqual({
      timestamp: "2026-07-20T00:00:00Z",
      provider: "openai",
      model: "gpt",
      connectionId: "c1",
      endpoint: "/v1/chat",
      status: "ok",
      tokens: 12,
    });
    expect(containsSecretMarkers(snap)).toBe(false);
  });

  it("pickAllowlisted ignores secret keys even if listed", () => {
    const picked = pickAllowlisted(
      { model: "x", apiKey: "secret", count: 1 },
      ["model", "apiKey", "count"],
    );
    expect(picked).toEqual({ model: "x", count: 1 });
  });
});

describe("mw-spa DTO sanitizers", () => {
  it("sanitizeWorkersDto defaults to unavailable", () => {
    expect(sanitizeWorkersDto(null)).toEqual({
      availability: "unavailable",
      expectedCount: 0,
      freshCount: 0,
    });
    expect(sanitizeWorkersDto({ availability: "degraded", pid: 9 })).toEqual({
      availability: "degraded",
      expectedCount: 0,
      freshCount: 0,
    });
  });

  it("sanitizeUsageDto coerces numbers and strips secrets", () => {
    const dto = sanitizeUsageDto({
      period: "7d",
      totalRequests: "5",
      totalTokens: 100,
      successCount: 4,
      errorCount: 1,
      apiKey: "x",
    });
    expect(dto).toEqual({
      period: "7d",
      totalRequests: 5,
      totalTokens: 100,
      successCount: 4,
      errorCount: 1,
    });
  });

  it("sanitizeProvidersDto degrades empty input", () => {
    expect(sanitizeProvidersDto(null)).toEqual({
      providers: [],
      mode: "degraded",
    });
    const dto = sanitizeProvidersDto({
      mode: "ok",
      providers: [{ provider: "openai", apiKey: "x" }],
    });
    expect(dto.providers[0].provider).toBe("openai");
    expect(dto.providers[0].apiKey).toBeUndefined();
  });

  it("sanitizeOverviewDto shapes redis + workers", () => {
    const dto = sanitizeOverviewDto({
      redis: {
        mode: "degraded",
        activeCount: 0,
        recentCount: 0,
        lastError: "timeout",
        internalSecret: "no",
      },
      workers: { availability: "unavailable" },
    });
    expect(dto.redis.mode).toBe("degraded");
    expect(dto.redis.lastError).toBe("timeout");
    expect(dto.workers.availability).toBe("unavailable");
    expect(containsSecretMarkers(dto)).toBe(false);
  });
});

describe("mw-spa state mapping", () => {
  it("maps worker availability honestly", () => {
    expect(mapWorkerAvailability("unavailable").tone).toBe("danger");
    expect(mapWorkerAvailability("degraded").tone).toBe("warning");
    expect(mapWorkerAvailability("unavailable").detail).toMatch(/does not invent/i);
  });

  it("maps redis mode", () => {
    expect(mapRedisMode("redis").tone).toBe("ok");
    expect(mapRedisMode("degraded").tone).toBe("warning");
  });

  it("maps page view for unauthenticated", () => {
    const view = mapPageViewState(
      {
        kind: "unauthenticated",
        message: "Sign-in required",
      },
      "ready",
    );
    expect(view.phase).toBe("unauthenticated");
    expect(view.banner.title).toMatch(/Sign-in/i);
    expect(view.showData).toBe(false);
  });

  it("maps loading and empty phases", () => {
    expect(mapPageViewState(null, "loading").phase).toBe("loading");
    expect(
      mapPageViewState({ kind: "empty", empty: true }, "ready").phase,
    ).toBe("empty");
  });

  it("formats counts and lastError safely", () => {
    expect(formatCount(1200)).toBe("1.2k");
    expect(formatCount(null)).toBe("—");
    expect(formatLastError(null)).toBeNull();
    expect(formatLastError("plain error")).toBe("plain error");
    expect(formatLastError("leaked apiKey value")).toMatch(/withheld/i);
    expect(formatLastError({ apiKey: "x" })).toMatch(/withheld/i);
  });
});
