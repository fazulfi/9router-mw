/**
 * Failing regression tests for per-worker heartbeat aggregation.
 *
 * The worker-reader module currently reads a single global
 * `mw:worker:heartbeat` key.  The approved design requires per-worker
 * aggregation: read `mw:worker:heartbeat:{id}` for each expected worker,
 * include only genuinely fresh heartbeats, and report honest
 * partial / unavailable availability.
 *
 * These tests will fail RED because the current implementation
 *   - reads a single global key (not per-worker MGET)
 *   - never returns a `workers[]` array
 *   - never differentiates partial vs unavailable
 *
 * Once the production reader is updated to support per-worker
 * aggregation, these tests should pass GREEN.
 */

import { describe, it, expect, vi } from "vitest";
import { readWorkerObservability } from "../../src/lib/mw/readModel/workerReader.js";

const NOW = 1_700_000_000_000;
const TTL_MS = 60_000;
const WORKER_COUNT = 4;

function freshHeartbeat(workerId, ageMs = 1_000) {
  return {
    status: "ready",
    workerId,
    schemaVersion: 1,
    observedAt: NOW - ageMs,
  };
}

function buildRedis(perWorkerPayload) {
  // perWorkerPayload: { "1": JSON | null, "2": JSON | null, ... }
  return {
    mget: vi.fn(async (...keys) => {
      return keys.map((k) => {
        // Extract worker id from key "mw:worker:heartbeat:{id}"
        const m = /^mw:worker:heartbeat:(\d+)$/.exec(k);
        if (!m) return null;
        const v = perWorkerPayload[m[1]];
        return v == null ? null : v;
      });
    }),
    get: vi.fn().mockResolvedValue(null),
    keys: vi.fn(),
    scan: vi.fn(),
    smembers: vi.fn(),
  };
}

describe("MW per-worker heartbeat aggregation", () => {
  // All workers present & fresh -> ok

  it("returns ok with full per-worker list when all workers are fresh", async () => {
    const redis = buildRedis({
      "1": JSON.stringify(freshHeartbeat("1", 1_000)),
      "2": JSON.stringify(freshHeartbeat("2", 2_000)),
      "3": JSON.stringify(freshHeartbeat("3", 3_000)),
      "4": JSON.stringify(freshHeartbeat("4", 4_000)),
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("ok");
    expect(dto.expectedCount).toBe(WORKER_COUNT);
    expect(Array.isArray(dto.workers)).toBe(true);
    expect(dto.workers).toHaveLength(WORKER_COUNT);
    expect(dto.missingWorkerIds).toEqual([]);

    for (const w of dto.workers) {
      expect(w.workerId).toMatch(/^[1-4]$/);
      expect(w.status).toBe("ready");
      expect(w.observedAt).toBeTypeOf("number");
      expect(w.ageMs).toBeTypeOf("number");
      expect(w.ageMs).toBeGreaterThanOrEqual(0);
      expect(w.ageMs).toBeLessThanOrEqual(TTL_MS);
    }
  });

  // Some workers missing or stale -> partial

  it("returns partial when some workers are missing", async () => {
    const redis = buildRedis({
      "1": JSON.stringify(freshHeartbeat("1")),
      "2": JSON.stringify(freshHeartbeat("2")),
      "3": null,
      "4": null,
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("partial");
    expect(dto.expectedCount).toBe(WORKER_COUNT);
    expect(dto.workers).toHaveLength(2);
    expect(dto.workers.map((w) => w.workerId).sort()).toEqual(["1", "2"]);
    expect(dto.missingWorkerIds.sort()).toEqual(["3", "4"]);
  });

  it("returns partial when some workers are stale and omits stale entries", async () => {
    const stale = freshHeartbeat("3", TTL_MS + 1_000); // older than TTL
    const redis = buildRedis({
      "1": JSON.stringify(freshHeartbeat("1", 1_000)),
      "2": JSON.stringify(freshHeartbeat("2", 2_000)),
      "3": JSON.stringify(stale), // stale
      "4": JSON.stringify(freshHeartbeat("4", 4_000)),
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("partial");
    expect(dto.workers).toHaveLength(3);
    expect(dto.workers.map((w) => w.workerId).sort()).toEqual(["1", "2", "4"]);
    // The stale worker id MUST NOT appear in the workers list.
    expect(dto.workers.find((w) => w.workerId === "3")).toBeUndefined();
    expect(dto.missingWorkerIds).toContain("3");
  });

  // All workers missing or stale -> unavailable

  it("returns unavailable when no workers report a fresh heartbeat", async () => {
    const redis = buildRedis({
      "1": null,
      "2": null,
      "3": null,
      "4": null,
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("unavailable");
    expect(dto.expectedCount).toBe(WORKER_COUNT);
    expect(dto.workers).toEqual([]);
  });

  it("returns unavailable when all workers report stale heartbeats", async () => {
    const redis = buildRedis({
      "1": JSON.stringify(freshHeartbeat("1", TTL_MS + 10_000)),
      "2": JSON.stringify(freshHeartbeat("2", TTL_MS + 20_000)),
      "3": null,
      "4": null,
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("unavailable");
    expect(dto.workers).toEqual([]);
  });

  // Per-worker key isolation

  it("uses per-worker keys via bounded MGET (no KEYS, SCAN, or SMEMBERS)", async () => {
    const redis = buildRedis({
      "1": JSON.stringify(freshHeartbeat("1")),
      "2": JSON.stringify(freshHeartbeat("2")),
      "3": JSON.stringify(freshHeartbeat("3")),
      "4": JSON.stringify(freshHeartbeat("4")),
    });

    await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    // Must NOT use unbounded scans.
    expect(redis.scan).not.toHaveBeenCalled();
    // Must NOT use KEYS.
    expect(redis.keys).not.toHaveBeenCalled();
    // Must NOT use SMEMBERS.
    expect(redis.smembers).not.toHaveBeenCalled();
    // The legacy single-key GET is also not used.
    expect(redis.get).not.toHaveBeenCalled();

    // Must use MGET on per-worker keys, exactly N keys.
    expect(redis.mget).toHaveBeenCalledTimes(1);
    const keys = redis.mget.mock.calls[0];
    expect(keys).toHaveLength(WORKER_COUNT);
    expect(keys).toContain("mw:worker:heartbeat:1");
    expect(keys).toContain("mw:worker:heartbeat:2");
    expect(keys).toContain("mw:worker:heartbeat:3");
    expect(keys).toContain("mw:worker:heartbeat:4");
  });

  // Safe per-worker projection

  it("only emits safe per-worker fields (no host, pid, cpu, memory)", async () => {
    // Inject a hostile payload that tries to leak host/cpu.
    const hostile = {
      status: "ready",
      workerId: "1",
      schemaVersion: 1,
      observedAt: NOW - 1_000,
      host: "internal-prod-01",
      pid: 12345,
      cpu: 0.42,
      memory: { rss: 999_999_999 },
      hostname: "leaked.example.com",
      username: "root",
    };
    const redis = buildRedis({
      "1": JSON.stringify(hostile),
      "2": null,
      "3": null,
      "4": null,
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    const w = dto.workers.find((x) => x.workerId === "1");
    expect(w).toBeDefined();
    expect(w).not.toHaveProperty("host");
    expect(w).not.toHaveProperty("pid");
    expect(w).not.toHaveProperty("cpu");
    expect(w).not.toHaveProperty("memory");
    expect(w).not.toHaveProperty("hostname");
    expect(w).not.toHaveProperty("username");

    // The serialized projection must not contain those strings.
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toMatch(/internal-prod-01|leaked\.example\.com/);
  });

  // Malformed JSON in a single key is dropped, not propagated

  it("drops malformed per-worker JSON without crashing the aggregation", async () => {
    const redis = buildRedis({
      "1": JSON.stringify(freshHeartbeat("1")),
      "2": "{not-json",
      "3": JSON.stringify(freshHeartbeat("3")),
      "4": null,
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    // Malformed count as missing - they appear in missingWorkerIds.
    expect(dto.availability).toBe("partial");
    expect(dto.missingWorkerIds).toContain("2");
    expect(dto.missingWorkerIds).toContain("4");
    expect(dto.workers).toHaveLength(2);
    expect(dto.workers.map((w) => w.workerId).sort()).toEqual(["1", "3"]);
  });

  // Unsupported status values are dropped

  it("omits workers whose status is not 'ready' and does not invent a new status", async () => {
    const redis = buildRedis({
      "1": JSON.stringify({ ...freshHeartbeat("1"), status: "starting" }),
      "2": JSON.stringify(freshHeartbeat("2", 1_000)),
      "3": JSON.stringify({ ...freshHeartbeat("3"), status: "stopping" }),
      "4": JSON.stringify(freshHeartbeat("4", 1_000)),
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    // Starting/stopping workers are not "ready" - they're treated as missing.
    expect(dto.availability).toBe("partial");
    expect(dto.workers.map((w) => w.workerId).sort()).toEqual(["2", "4"]);
    expect(dto.missingWorkerIds.sort()).toEqual(["1", "3"]);
  });

  // Redis failure -> unavailable, no crash

  it("returns unavailable when redis.mget throws", async () => {
    // The producer-of-truth is the MGET call: when per-worker aggregation
    // is implemented it must MGET first and must not throw. A rejecting
    // MGET must be caught and the reader must return unavailable.
    const redis = {
      mget: vi.fn().mockRejectedValue(new Error("Redis offline")),
      get: vi.fn().mockResolvedValue(null),
      keys: vi.fn(),
      scan: vi.fn(),
      smembers: vi.fn(),
    };

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("unavailable");
  });

  it("returns unavailable when redis is null", async () => {
    const dto = await readWorkerObservability(null, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("unavailable");
  });

  // Schema version is pinned to a single supported value

  it("drops heartbeats with unsupported schemaVersion", async () => {
    const redis = buildRedis({
      "1": JSON.stringify({ ...freshHeartbeat("1"), schemaVersion: 99 }),
      "2": JSON.stringify(freshHeartbeat("2")),
      "3": null,
      "4": null,
    });

    const dto = await readWorkerObservability(redis, {
      now: NOW,
      workerCount: WORKER_COUNT,
      ttlMs: TTL_MS,
    });

    expect(dto.availability).toBe("partial");
    expect(dto.workers.map((w) => w.workerId)).toEqual(["2"]);
    expect(dto.missingWorkerIds).toContain("1");
  });
});
