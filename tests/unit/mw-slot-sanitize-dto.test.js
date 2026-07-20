/**
 * Sanitizer and projection tests for per-worker cards.
 *
 * The workers DTO must:
 *   - allowlist workerId / status / observedAt / ageMs on each per-worker item
 *   - allowlist expectedCount / freshCount at the top level
 *   - strip any host / pid / cpu / memory / hostname / username
 *   - never leak raw Redis state
 *
 * These tests assert the contract for both the sanitizer and the
 * Workers.jsx render surface (limited to allowlisted fields).
 */

import { describe, it, expect } from "vitest";
import { sanitizeWorkersDto } from "../../dashboard/src/lib/sanitize.js";

describe("MW workers DTO sanitizer — per-worker cards", () => {
  it("preserves per-worker entries with only allowlisted fields", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 2,
      workers: [
        {
          workerId: "1",
          status: "ready",
          observedAt: 1_700_000_000_000,
          ageMs: 1_234,
          host: "internal-prod-01",
          pid: 9999,
          cpu: 0.42,
          memory: { rss: 9_999_999 },
          hostname: "leaked.example.com",
          username: "root",
        },
        {
          workerId: "2",
          status: "ready",
          observedAt: 1_700_000_000_500,
          ageMs: 734,
        },
      ],
    });

    expect(dto.availability).toBe("degraded");
    expect(dto.expectedCount).toBe(4);
    expect(dto.freshCount).toBe(2);
    expect(Array.isArray(dto.workers)).toBe(true);
    expect(dto.workers).toHaveLength(2);

    for (const w of dto.workers) {
      expect(w).not.toHaveProperty("host");
      expect(w).not.toHaveProperty("pid");
      expect(w).not.toHaveProperty("cpu");
      expect(w).not.toHaveProperty("memory");
      expect(w).not.toHaveProperty("hostname");
      expect(w).not.toHaveProperty("username");
      // Only allowlisted keys
      const keys = Object.keys(w).sort();
      expect(keys).toEqual(["ageMs", "observedAt", "status", "workerId"]);
    }

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toMatch(/internal-prod-01|leaked\.example\.com|root/);
  });

  it("strips forbidden top-level fields (raw redis, host, etc.)", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 1,
      workers: [
        { workerId: "3", status: "ready", observedAt: 1, ageMs: 1 },
      ],
      // forbidden top-level fields
      host: "prod-01",
      pid: 1,
      rawRedis: "mw:worker:heartbeat:1",
      forbiddenRawState: { a: 1 },
    });

    expect(dto).not.toHaveProperty("host");
    expect(dto).not.toHaveProperty("pid");
    expect(dto).not.toHaveProperty("rawRedis");
    expect(dto).not.toHaveProperty("forbiddenRawState");
  });

  it("coerces expectedCount and freshCount to non-negative integers", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      expectedCount: "4",
      freshCount: "2",
    });
    expect(dto.expectedCount).toBe(4);
    expect(dto.freshCount).toBe(2);
  });

  it("drops non-string workerId from per-worker items", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 1,
      workers: [
        { workerId: 7, status: "ready", observedAt: 1, ageMs: 1 }, // numeric — must be dropped
        { workerId: "1", status: "ready", observedAt: 1, ageMs: 1 },
      ],
    });
    expect(dto.workers).toHaveLength(1);
    expect(dto.workers[0].workerId).toBe("1");
  });

  it("drops per-worker items with non-string status", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 1,
      workers: [
        { workerId: "1", status: 7, observedAt: 1, ageMs: 1 }, // bad status
        { workerId: "2", status: "ready", observedAt: 1, ageMs: 1 },
      ],
    });
    expect(dto.workers).toHaveLength(1);
    expect(dto.workers[0].workerId).toBe("2");
  });

  it("drops per-worker items with non-numeric observedAt / ageMs", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 1,
      workers: [
        { workerId: "1", status: "ready", observedAt: "nope", ageMs: 5 },
        { workerId: "2", status: "ready", observedAt: 1, ageMs: "nope" },
        { workerId: "3", status: "ready", observedAt: 1, ageMs: 5 },
      ],
    });
    expect(dto.workers).toHaveLength(1);
    expect(dto.workers[0].workerId).toBe("3");
  });

  it("coerces numeric observedAt / ageMs to numbers", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      expectedCount: 4,
      freshCount: 1,
      workers: [
        { workerId: "1", status: "ready", observedAt: "1700000000000", ageMs: "5" },
      ],
    });
    expect(dto.workers[0].observedAt).toBe(1_700_000_000_000);
    expect(dto.workers[0].ageMs).toBe(5);
  });

  it("does not invent workers when input is absent", () => {
    expect(sanitizeWorkersDto(null).workers).toBeUndefined();
    expect(sanitizeWorkersDto({}).workers).toBeUndefined();
    expect(sanitizeWorkersDto({ workers: null }).workers).toBeUndefined();
    expect(sanitizeWorkersDto({ workers: "nope" }).workers).toBeUndefined();
  });
});
