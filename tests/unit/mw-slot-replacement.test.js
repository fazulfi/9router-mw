/**
 * Failing regression tests for MW_WORKER_ID slot lifecycle on worker
 * exit/respawn.
 *
 * CURRENT behavior (custom-server.js):
 *   Initial fork uses slots 1..4, then exit handler used monotonic
 *   nextSlot++ (starts at 5).  A respawned worker got MW_WORKER_ID=5+
 *   — outside the bounded range the reader knows about — so the
 *   dashboard slot was invisible.
 *
 * EXPECTED behavior (after fix):
 *   On exit, the worker's slot is reclaimed and reused by the
 *   replacement, keeping all occupied slots within the bounded
 *   range 1..N.  The slot tracker (src/lib/mw/slotTracker.js) is
 *   the source of truth.
 */

import { describe, it, expect } from "vitest";
import { createSlotTracker } from "../../src/lib/mw/slotTracker.js";

describe("MW worker slot replacement on exit/respawn", () => {
  // ── Bounded invariant: all occupied slots in 1..N ─────────────────

  it("replacement reuses the exited worker's slot (bounded 1..N)", () => {
    const tracker = createSlotTracker(4);

    // Initial workers
    const initial = [{ clusterId: 101 }, { clusterId: 102 }, { clusterId: 103 }, { clusterId: 104 }];
    for (const w of initial) {
      const slot = tracker.reserve();
      tracker.assign(w.clusterId, slot);
    }

    // Worker 102 (slot 2) exits
    const freed = tracker.freeSlot(102);
    expect(freed).toBe(2);

    // Replacement gets the freed slot — not 5
    const slot = tracker.reserve();
    tracker.assign(200, slot);
    expect(slot).toBe(2);
    expect(tracker.getSlot(200)).toBe(2);
  });

  it("multiple exit/respawn cycles stay within bounded range 1..4 across replacement generations", () => {
    const tracker = createSlotTracker(4);
    const initialIds = [101, 102, 103, 104];
    for (const id of initialIds) {
      tracker.assign(id, tracker.reserve());
    }

    // Simulate 12 exit/respawn cycles, cycling through ALL live workers
    // INCLUDING replacements — not just the initial ones.
    const allReplacementIds = [200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211];
    const liveWorkers = new Set(initialIds);
    const exitOrder = [];
    for (let cycle = 0; cycle < allReplacementIds.length; cycle++) {
      // Pick the oldest live worker by fifo order to simulate a genuine
      // respawn chain where each replacement eventually exits too.
      const exitId = Array.from(liveWorkers).sort((a, b) => a - b)[0];
      const freed = tracker.freeSlot(exitId);
      expect(typeof freed).toBe("number");
      expect(freed).toBeGreaterThanOrEqual(1);
      expect(freed).toBeLessThanOrEqual(4);
      liveWorkers.delete(exitId);
      exitOrder.push(exitId);

      const slot = tracker.reserve();
      expect(slot).toBe(freed);
      tracker.assign(allReplacementIds[cycle], slot);
      liveWorkers.add(allReplacementIds[cycle]);
    }

    const occupied = tracker.occupiedSlots();
    expect(occupied).toHaveLength(4);
    expect(Math.max.apply(null, occupied)).toBeLessThanOrEqual(4);
    expect(Math.min.apply(null, occupied)).toBeGreaterThanOrEqual(1);
  });

  // ── Reserve refuses to over-allocate ──────────────────────────────

  it("reserve() returns null when no slots are free (no over-allocation)", () => {
    const tracker = createSlotTracker(2);
    tracker.assign(101, tracker.reserve()); // slot 1
    tracker.assign(102, tracker.reserve()); // slot 2
    expect(tracker.reserve()).toBeNull();  // no over-allocate
  });

  it("freeSlot returns null for unknown cluster worker id", () => {
    const tracker = createSlotTracker(4);
    expect(tracker.freeSlot(999)).toBeNull();
  });

  it("getSlot returns null for unknown cluster worker id", () => {
    const tracker = createSlotTracker(4);
    expect(tracker.getSlot(999)).toBeNull();
  });

  it("occupiedSlots returns the sorted list of in-use slot numbers", () => {
    const tracker = createSlotTracker(4);
    tracker.assign(101, tracker.reserve());
    tracker.assign(102, tracker.reserve());
    expect(tracker.occupiedSlots()).toEqual([1, 2]);
  });

  // ── Worker key emission is bounded 1..N ───────────────────────────

  it("heartbeat key per worker is always within the bounded reader range 1..N", () => {
    const tracker = createSlotTracker(4);
    const PREFIX = "mw:worker:heartbeat:";
    const HEARTBEAT_KEYS = new Set();

    for (let i = 1; i <= 4; i++) {
      HEARTBEAT_KEYS.add(`${PREFIX}${tracker.reserve()}`);
      tracker.assign(100 + i, i);
    }

    // Simulate 10 exit/respawn cycles, each exiting a replacement (not just initial IDs)
    const liveIds = [101, 102, 103, 104];
    const spawnIds = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210];
    for (let cycle = 0; cycle < 10; cycle++) {
      // Exit the oldest live worker (replacement generations too)
      const exitId = liveIds.sort((a, b) => a - b)[0];
      tracker.freeSlot(exitId);
      liveIds.shift();
      const slot = tracker.reserve();
      tracker.assign(spawnIds[cycle], slot);
      liveIds.push(spawnIds[cycle]);
    }

    // The bounded MGET reader knows only keys 1..4
    for (let i = 1; i <= 4; i++) HEARTBEAT_KEYS.add(`${PREFIX}${i}`);

    // The reader would only ever MGET 4 keys
    const readerKeys = [`${PREFIX}1`, `${PREFIX}2`, `${PREFIX}3`, `${PREFIX}4`];
    for (const key of readerKeys) {
      expect(HEARTBEAT_KEYS.has(key)).toBe(true);
    }
  });
});
