/**
 * Workers route DTO projection — per-worker cards contract.
 *
 * The /mw/api/v1/workers handler must return bounded aggregate
 * fields (availability, expectedCount, freshCount, schemaVersion)
 * and an allowlisted workers[] array.  Anything else from the
 * reader is dropped at the route boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  getRedis: vi.fn(),
  workerObservability: vi.fn(),
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verify,
}));

vi.mock("@/lib/mw/deps", () => ({
  getMwRedis: mocks.getRedis,
}));

vi.mock("@/lib/mw/readModel/workerReader", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readWorkerObservability: mocks.workerObservability,
  };
});

const workers = await import("../../src/app/mw/api/v1/workers/route.js");

function request() {
  return {
    url: "http://localhost/mw/api/v1/workers",
    cookies: { get: vi.fn(() => ({ value: "valid" })) },
  };
}

async function json(response) {
  return response.json();
}

describe("MW workers route — per-worker DTO projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue(true);
    mocks.getRedis.mockResolvedValue({});
  });

  it("returns expectedCount and freshCount when all workers fresh", async () => {
    mocks.workerObservability.mockResolvedValue({
      availability: "ok",
      expectedCount: 4,
      freshCount: 4,
      workers: [
        { workerId: "1", status: "ready", observedAt: 1, ageMs: 1 },
        { workerId: "2", status: "ready", observedAt: 1, ageMs: 1 },
        { workerId: "3", status: "ready", observedAt: 1, ageMs: 1 },
        { workerId: "4", status: "ready", observedAt: 1, ageMs: 1 },
      ],
      missingWorkerIds: [],
    });

    const body = await json(await workers.GET(request()));
    expect(body.availability).toBe("ok");
    expect(body.expectedCount).toBe(4);
    expect(body.freshCount).toBe(4);
    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.workers).toHaveLength(4);
    expect(body.missingWorkerIds).toEqual([]);
  });

  it("returns partial with per-worker list and missingWorkerIds when some are missing", async () => {
    mocks.workerObservability.mockResolvedValue({
      availability: "partial",
      expectedCount: 4,
      freshCount: 2,
      workers: [
        { workerId: "1", status: "ready", observedAt: 1, ageMs: 1 },
        { workerId: "3", status: "ready", observedAt: 1, ageMs: 1 },
      ],
      missingWorkerIds: ["2", "4"],
    });

    const body = await json(await workers.GET(request()));
    expect(body.availability).toBe("partial");
    expect(body.expectedCount).toBe(4);
    expect(body.freshCount).toBe(2);
    expect(body.workers.map((w) => w.workerId).sort()).toEqual(["1", "3"]);
    expect(body.missingWorkerIds.sort()).toEqual(["2", "4"]);
  });

  it("returns unavailable with empty workers and zero freshCount", async () => {
    mocks.workerObservability.mockResolvedValue({
      availability: "unavailable",
      expectedCount: 4,
      freshCount: 0,
      workers: [],
    });

    const body = await json(await workers.GET(request()));
    expect(body.availability).toBe("unavailable");
    expect(body.expectedCount).toBe(4);
    expect(body.freshCount).toBe(0);
    // workers is omitted when empty (the route projects only safe fields)
    expect(body.workers).toBeUndefined();
  });

  it("strips forbidden fields from per-worker items in the route DTO", async () => {
    mocks.workerObservability.mockResolvedValue({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 1,
      workers: [
        {
          workerId: "1",
          status: "ready",
          observedAt: 1,
          ageMs: 1,
          host: "internal-prod-01",
          pid: 9999,
          cpu: 0.42,
          memory: { rss: 9_999_999 },
          hostname: "leaked.example.com",
          username: "root",
        },
      ],
    });

    const body = await json(await workers.GET(request()));
    const w = body.workers[0];
    expect(w).not.toHaveProperty("host");
    expect(w).not.toHaveProperty("pid");
    expect(w).not.toHaveProperty("cpu");
    expect(w).not.toHaveProperty("memory");
    expect(w).not.toHaveProperty("hostname");
    expect(w).not.toHaveProperty("username");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/internal-prod-01|leaked\.example\.com/);
  });

  it("does not include any raw Redis state in the DTO", async () => {
    mocks.workerObservability.mockResolvedValue({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 1,
      workers: [{ workerId: "1", status: "ready", observedAt: 1, ageMs: 1 }],
      rawRedis: { state: "should not be here" },
    });

    const body = await json(await workers.GET(request()));
    expect(body).not.toHaveProperty("rawRedis");
  });

  it("rejects missing JWT with 401", async () => {
    mocks.verify.mockResolvedValue(false);
    const response = await workers.GET({
      url: "http://localhost/mw/api/v1/workers",
      cookies: { get: () => undefined },
    });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "Unauthorized" });
  });
});
