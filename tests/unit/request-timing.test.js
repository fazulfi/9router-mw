import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cloneRequestTiming,
  measureRequestPhase,
  recordRequestPhase,
  sanitizeRequestPhases,
} from "../../open-sse/utils/requestTiming.js";

describe("request phase timing helper", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps only bounded non-negative finite integer millisecond phases", () => {
    expect(sanitizeRequestPhases({
      ingress_ms: 1.6,
      auth_ms: Number.NaN,
      routing_ms: Number.POSITIVE_INFINITY,
      db_ms: -1,
      translation_ms: 4,
      dynamic_provider_ms: 99,
    })).toEqual({
      ingress_ms: 2,
      translation_ms: 4,
    });
  });

  it("accumulates measured durations without inventing missing phases", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const phases = {};

    const value = await measureRequestPhase(phases, "auth_ms", async () => {
      vi.setSystemTime(1_007);
      return "ok";
    });
    recordRequestPhase(phases, "auth_ms", 1_007, 1_012);
    recordRequestPhase(phases, "unknown_ms", 1_012, 1_020);

    expect(value).toBe("ok");
    expect(phases).toEqual({ auth_ms: 12 });
    expect(phases).not.toHaveProperty("db_ms");
  });

  it("clones pre-attempt phases so attempt mutations stay isolated", () => {
    const requestTiming = {
      startedAt: 1_000,
      phases: { ingress_ms: 3, routing_ms: 5 },
    };

    const attemptA = cloneRequestTiming(requestTiming);
    const attemptB = cloneRequestTiming(requestTiming);
    attemptA.phases.translation_ms = 40;

    expect(attemptB).toEqual(requestTiming);
    expect(attemptB.phases).not.toBe(requestTiming.phases);
    expect(attemptB.phases).not.toHaveProperty("translation_ms");
  });
});
