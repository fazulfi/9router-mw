/**
 * Request-details event buffer.
 * Redis list mw:details:queue → async flusher → SQLite (caller provides flushFn).
 * Mirror of usageBuffer.js for request-detail writes.
 * Fail-open: if Redis down, queue drops (detail loss acceptable).
 */

import { withRedis, getRedis } from "./redisClient.js";

const QUEUE_KEY = "mw:details:queue";
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 30;

/** @type {ReturnType<typeof setInterval> | null} */
let flusherTimer = null;
/** @type {((details: object[]) => Promise<void> | void) | null} */
let flushHandler = null;
/** @type {boolean} */
let flushing = false;

/**
 * Enqueue a request-detail event (JSON-serializable object).
 * @param {object} detail
 * @returns {Promise<boolean>}
 */
export async function enqueueDetailEvent(detail) {
  const payload = JSON.stringify({ ...detail, _enqueuedAt: Date.now() });

  return withRedis(
    async (redis) => {
      await redis.rpush(QUEUE_KEY, payload);
      return true;
    },
    async () => {
      // No fallback for details — detail loss acceptable under Redis outage
      return false;
    },
  );
}

/**
 * Drain up to batchSize details from Redis queue.
 * @param {number} [batchSize]
 * @returns {Promise<object[]>}
 */
export async function drainDetailsBatch(batchSize = DEFAULT_BATCH_SIZE) {
  const redis = await getRedis();
  if (!redis) return [];

  const events = [];
  try {
    for (let i = 0; i < batchSize; i++) {
      const raw = await redis.lpop(QUEUE_KEY);
      if (raw == null) break;
      try {
        events.push(JSON.parse(raw));
      } catch {
        /* skip corrupt */
      }
    }
  } catch {
    return events;
  }
  return events;
}

/**
 * @param {(details: object[]) => Promise<void> | void} flushFn
 * @param {{ intervalMs?: number, batchSize?: number }} [opts]
 */
export function startDetailsFlusher(flushFn, opts = {}) {
  flushHandler = flushFn;
  const intervalMs = Math.max(500, Number(opts.intervalMs || process.env.MW_DETAILS_FLUSH_MS || DEFAULT_FLUSH_INTERVAL_MS));
  const batchSize = Math.max(1, Number(opts.batchSize || process.env.MW_DETAILS_BATCH || DEFAULT_BATCH_SIZE));

  stopDetailsFlusher();

  flusherTimer = setInterval(() => {
    void tickFlush(batchSize);
  }, intervalMs);
  if (typeof flusherTimer.unref === "function") {
    flusherTimer.unref();
  }
}

async function tickFlush(batchSize) {
  if (flushing || !flushHandler) return;
  flushing = true;
  try {
    const events = await drainDetailsBatch(batchSize);
    if (events.length > 0) {
      await flushHandler(events);
    }
  } catch {
    /* never throw out of flusher */
  } finally {
    flushing = false;
  }
}

export function stopDetailsFlusher() {
  if (flusherTimer) {
    clearInterval(flusherTimer);
    flusherTimer = null;
  }
}

export const DETAILS_QUEUE_KEY = QUEUE_KEY;
