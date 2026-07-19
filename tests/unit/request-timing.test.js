import { afterEach, describe, expect, it, vi } from "vitest";

import * as requestTiming from "../../open-sse/utils/requestTiming.js";

describe("request phase timing helper", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps only bounded fields whose names expose cumulative and overlapping semantics", () => {
    expect(requestTiming.sanitizeRequestPhases({
      ingress_ms: 2,
      auth_total_ms: 5,
      routing_total_ms: 7,
      db_overlap_ms: 3,
      request_before_dispatch_total_ms: 20,
      fallback_total_ms: 4,
      translation_ms: Number.NaN,
      compression_ms: Number.POSITIVE_INFINITY,
      response_ms: -1,
      auth_ms: 99,
      local_before_dispatch_ms: 99,
      dynamic_provider_ms: 99,
    })).toEqual({
      ingress_ms: 2,
      auth_total_ms: 5,
      routing_total_ms: 7,
      db_overlap_ms: 3,
      request_before_dispatch_total_ms: 20,
      fallback_total_ms: 4,
    });
  });

  it("measures durations from monotonic performance time despite wall-clock rollback", async () => {
    let monotonicNow = 1_000;
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => monotonicNow);
    const phases = {};

    const value = await requestTiming.measureRequestPhase(phases, "auth_total_ms", async () => {
      vi.setSystemTime(10_000);
      monotonicNow += 7;
      return "ok";
    });
    requestTiming.recordRequestPhase(phases, "auth_total_ms", monotonicNow, monotonicNow + 5);

    expect(value).toBe("ok");
    expect(phases).toEqual({ auth_total_ms: 12 });
  });

  it("freezes admission timing and creates isolated attempt clocks", () => {
    expect(requestTiming.createRequestTiming).toBeTypeOf("function");
    expect(requestTiming.snapshotRequestTiming).toBeTypeOf("function");
    expect(requestTiming.createAttemptTiming).toBeTypeOf("function");

    let monotonicNow = 1_000;
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => monotonicNow);
    const parent = requestTiming.createRequestTiming();
    parent.phases.ingress_ms = 3;
    const admission = requestTiming.snapshotRequestTiming(parent);

    monotonicNow = 1_020;
    const attemptA = requestTiming.createAttemptTiming(admission, { fallback_total_ms: 4 });
    monotonicNow = 1_030;
    const attemptB = requestTiming.createAttemptTiming(admission, { fallback_total_ms: 9 });
    attemptA.phases.translation_ms = 40;

    expect(Object.isFrozen(admission)).toBe(true);
    expect(Object.isFrozen(admission.phases)).toBe(true);
    expect(attemptA.requestStartedAt).toBe(1_000);
    expect(attemptA.attemptStartedAt).toBe(1_020);
    expect(attemptB.attemptStartedAt).toBe(1_030);
    expect(attemptB.phases).toEqual({ ingress_ms: 3, fallback_total_ms: 9 });
    expect(attemptB.phases).not.toHaveProperty("translation_ms");
  });

  it("clamps invalid elapsed values without creating negative durations", () => {
    expect(requestTiming.elapsedRequestMilliseconds).toBeTypeOf("function");
    expect(requestTiming.elapsedRequestMilliseconds(10, 15.6)).toBe(6);
    expect(requestTiming.elapsedRequestMilliseconds(15, 10)).toBe(0);
    expect(requestTiming.elapsedRequestMilliseconds(Number.NaN, 10)).toBe(0);
  });
});
