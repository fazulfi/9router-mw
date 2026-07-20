import { describe, it, expect, vi } from "vitest";
import {
  projectWorkerObservability,
  readWorkerObservability,
} from "../../src/lib/mw/readModel/workerReader.js";

describe("Phase 1 worker observability projection", () => {
  it.each([
    ["absent", undefined],
    ["expired", { status: "expired", observedAt: 0 }],
    ["malformed", { status: "ready", observedAt: "not-a-timestamp" }],
    ["unsupported", { status: "ready", version: "future-unsupported" }],
  ])("returns bounded unavailable/degraded DTO for %s heartbeat", (_name, heartbeat) => {
    const dto = projectWorkerObservability(heartbeat, { now: 1_700_000_000_000 });

    expect(dto).toMatchObject({
      availability: expect.stringMatching(/^(unavailable|degraded)$/),
    });
    expect(dto).not.toHaveProperty("metrics.requests");
    expect(dto).not.toHaveProperty("metrics.latencyMs");
    expect(dto).not.toHaveProperty("metrics.errors");
  });

  it("does not fabricate per-worker metrics when the cross-worker heartbeat is unavailable", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      scan: vi.fn(),
      keys: vi.fn(),
    };

    const dto = await readWorkerObservability(redis, { now: 1_700_000_000_000 });

    expect(dto.availability).toBe("unavailable");
    expect(dto).not.toHaveProperty("workers");
    expect(dto).not.toHaveProperty("metrics");
    expect(redis.scan).not.toHaveBeenCalled();
    expect(redis.keys).not.toHaveBeenCalled();
  });

  it("does not claim hot-path instrumentation from a heartbeat-only projection", () => {
    const dto = projectWorkerObservability({
      status: "ready",
      observedAt: 1_700_000_000_000,
      schemaVersion: 1,
    }, { now: 1_700_000_001_000 });

    expect(dto).not.toHaveProperty("instrumentation");
    expect(dto).not.toHaveProperty("hotPath");
    expect(dto).not.toHaveProperty("requestMetrics");
    expect(dto).not.toHaveProperty("providerMetrics");
  });
});
