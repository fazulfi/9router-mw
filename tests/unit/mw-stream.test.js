import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/mw/deps.js", () => ({
  getMwRedis: vi.fn().mockResolvedValue(null),
  getRedisBounds: vi.fn(() => ({ scanCount: 25, maxCounterKeys: 50, recentLimit: 50 })),
}));

const { createStreamHandler } = await import("../../src/app/mw/api/v1/stream/route.js");

const secretNames = /apiKey|accessToken|credential|internalSecret/i;

function request(method = "GET") {
  return {
    method,
    cookies: { get: vi.fn(() => ({ value: "valid" })) },
  };
}

async function readChunk(reader) {
  const result = await reader.read();
  return new TextDecoder().decode(result.value);
}

describe("MW authenticated SSE stream", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects requests without valid JWT", async () => {
    const response = await createStreamHandler(request(), {
      verifyAuth: vi.fn().mockResolvedValue(false),
      readSnapshot: vi.fn(),
    });
    expect(response.status).toBe(401);
  });

  it("allows authenticated GET and sends bounded redacted snapshot", async () => {
    const response = await createStreamHandler(request(), {
      verifyAuth: vi.fn().mockResolvedValue(true),
      readSnapshot: vi.fn().mockResolvedValue({
        mode: "redis",
        active: [{ connectionId: "a", model: "m", count: 1 }],
        recent: [{ provider: "p", model: "m", apiKey: "nope", accessToken: "nope" }],
      }),
      heartbeatMs: 100000,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = response.body.getReader();
    const initial = await readChunk(reader);
    expect(initial).toContain("data: ");
    expect(initial).not.toMatch(secretNames);
    await reader.cancel();
  });

  it("rejects non-GET requests", async () => {
    const response = await createStreamHandler(request("POST"), {
      verifyAuth: vi.fn().mockResolvedValue(true),
      readSnapshot: vi.fn(),
    });
    expect(response.status).toBe(405);
  });

  it("emits heartbeat and cancellation cleans up", async () => {
    vi.useFakeTimers();
    const response = await createStreamHandler(request(), {
      verifyAuth: vi.fn().mockResolvedValue(true),
      readSnapshot: vi.fn().mockResolvedValue({ mode: "redis", active: [], recent: [] }),
      heartbeatMs: 20,
    });
    const reader = response.body.getReader();
    await readChunk(reader);
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(25);
    const heartbeatChunk = await pending;
    expect(heartbeatChunk.value).toBeTruthy();
    expect(new TextDecoder().decode(heartbeatChunk.value)).toContain(": ping");
    await expect(reader.cancel()).resolves.toBeUndefined();
  });
});

