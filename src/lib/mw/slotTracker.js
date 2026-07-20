/**
 * Slot tracker for the primary's worker fork lifecycle.
 *
 * Maps cluster worker ids (assigned by node:cluster) to the
 * stable bounded MW_WORKER_ID slots 1..N.  On worker exit, the
 * worker's slot is freed and reused by the replacement so the
 * bounded reader always sees at most N keys
 * (mw:worker:heartbeat:1..N).
 *
 * This module is the primary-only source of truth for slot
 * allocation.  The exit handler MUST free+reserve (never
 * monotonically grow) so the bounded MGET reader cannot
 * accidentally fall outside its known key list.
 */

/**
 * @param {number} workerCount
 */
export function createSlotTracker(workerCount) {
  const slots = new Map();      // clusterWorkerId → slot
  const free = new Set();        // free slot numbers
  for (let i = workerCount; i >= 1; i--) free.add(i);

  function reserve() {
    if (free.size === 0) return null;     // bounded — refuse to over-allocate
    // Pop the lowest free slot so the dashboard reader sees 1..N stable
    const slot = Math.min(...free);
    free.delete(slot);
    return slot;
  }

  function assign(clusterWorkerId, slot) {
    if (slot == null) return null;
    slots.set(clusterWorkerId, slot);
    return slot;
  }

  function freeSlot(clusterWorkerId) {
    const slot = slots.get(clusterWorkerId);
    if (slot == null) return null;
    slots.delete(clusterWorkerId);
    free.add(slot);
    return slot;
  }

  function getSlot(clusterWorkerId) {
    const v = slots.get(clusterWorkerId);
    return v == null ? null : v;
  }

  function occupiedSlots() {
    return Array.from(slots.values()).sort((a, b) => a - b);
  }

  return { reserve, assign, freeSlot, getSlot, occupiedSlots };
}
