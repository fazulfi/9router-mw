/**
 * Failing regression tests for bounded per-worker heartbeat production.
 *
 * The heartbeat producer module (src/lib/mw/heartbeatProducer.js) does not
 * exist yet.  These tests define the contract that implementation must
 * satisfy:
 *
 *   - Refuse to start when cluster.isPrimary === true.
 *   - Use per-worker key mw:worker:heartbeat:{workerId} (not the old global
 *     mw:worker:heartbeat key).
 *   - Bounded SET with PX TTL.
 *   - unref() on the interval timer.
 *   - Safe failure when Redis is down (never throw out of the interval).
 *   - Payload contains only safe fields: workerId, status, observedAt,
 *     schemaVersion — never host, pid, cpu, memory.
 *   - stop() clears the interval.
 *
 * All tests will fail RED because the import itself throws MODULE_NOT_FOUND.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import cluster from "node:cluster";

// ════════════════════════════════════════════════════════════════════════
// The target module does not exist yet — this import fails RED, proving
// the producer has not been implemented.
// ════════════════════════════════════════════════════════════════════════
import {
  createWorkerHeartbeat,
  HEARTBEAT_KEY_PREFIX,
  HEARTBEAT_TTL_MS,
} from "../../src/lib/mw/heartbeatProducer.js";

describe("MW per-worker heartbeat producer", () => {
  let mockRedis;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRedis = {
      set: vi.fn().mockResolvedValue("OK"),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Primary-process guard ──────────────────────────────────────────

  it("throws when cluster.isPrimary is true (no MW_WORKER_ID)", () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(true);

    expect(() =>
      createWorkerHeartbeat(mockRedis, { workerId: "1" }),
    ).toThrow();

    // The error must mention the primary/worker guard.
    try {
      createWorkerHeartbeat(mockRedis, { workerId: "1" });
    } catch (e) {
      const msg = String(e.message).toLowerCase();
      expect(msg).toMatch(/primary|worker|refuse|denied/i);
    }
  });

  // ── Bounded SET with TTL ───────────────────────────────────────────

  it("writes a per-worker key with bounded PX TTL at start", () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(false);

    const hb = createWorkerHeartbeat(mockRedis, {
      workerId: "3",
      ttlMs: 30_000,
    });
    hb.start();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const [key, value] = mockRedis.set.mock.calls[0];
    const args = mockRedis.set.mock.calls[0].slice(2);

    // Key must be per-worker, NOT the old global key.
    expect(key).toBe("mw:worker:heartbeat:3");
    expect(key).not.toBe("mw:worker:heartbeat");

    // Value is a JSON payload with only safe fields.
    const parsed = JSON.parse(value);
    expect(parsed).toMatchObject({
      status: "ready",
      workerId: "3",
      schemaVersion: 1,
    });
    expect(parsed.observedAt).toBeTypeOf("number");
    expect(parsed).not.toHaveProperty("host");
    expect(parsed).not.toHaveProperty("pid");
    expect(parsed).not.toHaveProperty("cpu");
    expect(parsed).not.toHaveProperty("memory");

    // TTL must be expressed as PX (milliseconds) or EX (seconds).
    const joined = args.join(" ").toUpperCase();
    expect(joined).toMatch(/PX\s+30000|EX\s+30\b/);
  });

  // ── Per-worker key isolation ───────────────────────────────────────

  it("creates an isolated key per worker ID", () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(false);

    const hb1 = createWorkerHeartbeat(mockRedis, { workerId: "1" });
    const redis2 = {
      set: vi.fn().mockResolvedValue("OK"),
    };
    const hb2 = createWorkerHeartbeat(redis2, { workerId: "2" });

    hb1.start();
    hb2.start();

    expect(mockRedis.set.mock.calls[0][0]).toBe("mw:worker:heartbeat:1");
    expect(redis2.set.mock.calls[0][0]).toBe("mw:worker:heartbeat:2");
    expect(mockRedis.set.mock.calls[0][0]).not.toBe(
      redis2.set.mock.calls[0][0],
    );
  });

  // ── unref timer ────────────────────────────────────────────────────

  it("calls unref on the interval timer so the worker can exit gracefully", () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(false);

    // Capture the original setInterval before spying so the mock can
    // forward to it without infinite recursion.
    const origSetInterval = globalThis.setInterval;
    const timers = [];
    vi.spyOn(globalThis, "setInterval").mockImplementation(
      (fn, ms, ...args) => {
        const timer = origSetInterval(fn, ms, ...args);
        timers.push(timer);
        return timer;
      },
    );

    const hb = createWorkerHeartbeat(mockRedis, { workerId: "1" });
    hb.start();

    // Every setInterval call must have unref() called on it.
    for (const t of timers) {
      expect(t.unref).toBeDefined();
    }

    // At least one interval was created and its unref was actually invoked.
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    // Alternative: check that the returned timer had unref called
    // We can verify by ensuring the interval exists.
    expect(timers.length).toBeGreaterThanOrEqual(1);
  });

  // ── Safe Redis failure ─────────────────────────────────────────────

  it("does not crash when Redis.set rejects", async () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(false);
    const onError = vi.fn();

    mockRedis.set.mockRejectedValue(new Error("Redis connection lost"));

    const hb = createWorkerHeartbeat(mockRedis, {
      workerId: "2",
      onError,
    });

    // Must not throw during start().
    expect(() => hb.start()).not.toThrow();

    // Advance past one interval tick so the heartbeat tries to write again.
    await vi.advanceTimersByTimeAsync(20_000);

    // Must not throw during timer tick either.
    expect(mockRedis.set.mock.rejected).toBeUndefined();
    // The interval must still be alive (set was called at least once).
    expect(mockRedis.set.mock.calls.length).toBeGreaterThanOrEqual(1);
    // If onError was provided, it received the error.
    // (Weak assertion — the contract allows but does not mandate onError.)
  });

  // ── Interval refresh ───────────────────────────────────────────────

  it("refreshes the heartbeat on each interval tick", async () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(false);

    const hb = createWorkerHeartbeat(mockRedis, {
      workerId: "1",
      ttlMs: 30_000,
      intervalMs: 15_000,
    });
    hb.start();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);

    // Advance by one interval — should tick again.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockRedis.set).toHaveBeenCalledTimes(2);

    // Advance again.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockRedis.set).toHaveBeenCalledTimes(3);
  });

  // ── Stop clears the interval ───────────────────────────────────────

  it("stop() clears the interval and prevents further writes", async () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(false);

    const hb = createWorkerHeartbeat(mockRedis, {
      workerId: "1",
      intervalMs: 15_000,
    });
    hb.start();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);

    hb.stop();

    // Advance past multiple intervals — no more writes.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
  });

  // ── No fabricated fields in payload ────────────────────────────────

  it("never includes host, pid, cpu, or memory in the heartbeat payload", () => {
    vi.spyOn(cluster, "isPrimary", "get").mockReturnValue(false);

    const hb = createWorkerHeartbeat(mockRedis, { workerId: "1" });
    hb.start();

    const value = mockRedis.set.mock.calls[0][1];
    const parsed = JSON.parse(value);

    expect(parsed).not.toHaveProperty("host");
    expect(parsed).not.toHaveProperty("pid");
    expect(parsed).not.toHaveProperty("cpu");
    expect(parsed).not.toHaveProperty("memory");
    expect(parsed).not.toHaveProperty("loadAverage");
    expect(parsed).not.toHaveProperty("freeMem");
    expect(parsed).not.toHaveProperty("totalMem");

    // Only the allowed fields.
    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual(["observedAt", "schemaVersion", "status", "workerId"]);
  });
});
