/**
 * Usage event buffer (Fase 4).
 * Redis list mw:usage:queue → async flusher → SQLite (caller provides flushFn).
 * Fail-open: if Redis down, invoke flushFn immediately (sync path degraded).
 */

import { withRedis, getRedis } from "./redisClient.js";

const QUEUE_KEY = "mw:usage:queue";
const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 50;

/** @type {ReturnType<typeof setInterval> | null} */
let flusherTimer = null;
/** @type {((events: object[]) => Promise<void> | void) | null} */
let flushHandler = null;
/** @type {boolean} */
let flushing = false;

/**
 * Enqueue a usage event (JSON-serializable object).
 * @param {object} event
 * @returns {Promise<{ queued: boolean, mode: "redis" | "direct" }>}
 */
export async function enqueueUsageEvent(event) {
  const payload = JSON.stringify({ ...event, _enqueuedAt: Date.now() });

  return withRedis(
    async (redis) => {
      await redis.rpush(QUEUE_KEY, payload);
      return { queued: true, mode: "redis" };
    },
    async () => {
      if (flushHandler) {
        await flushHandler([event]);
      }
      return { queued: true, mode: "direct" };
    },
  );
}

/**
 * Drain up to batchSize events from Redis queue.
 * @param {number} [batchSize]
 * @returns {Promise<object[]>}
 */
export async function drainUsageBatch(batchSize = DEFAULT_BATCH_SIZE) {
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
 * @param {(events: object[]) => Promise<void> | void} flushFn
 * @param {{ intervalMs?: number, batchSize?: number }} [opts]
 */
export function startUsageFlusher(flushFn, opts = {}) {
  flushHandler = flushFn;
  const intervalMs = Math.max(200, Number(opts.intervalMs || process.env.MW_USAGE_FLUSH_MS || DEFAULT_FLUSH_INTERVAL_MS));
  const batchSize = Math.max(1, Number(opts.batchSize || process.env.MW_USAGE_BATCH || DEFAULT_BATCH_SIZE));

  stopUsageFlusher();

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
    const events = await drainUsageBatch(batchSize);
    if (events.length > 0) {
      await flushHandler(events);
    }
  } catch {
    /* never throw out of flusher */
  } finally {
    flushing = false;
  }
}

export function stopUsageFlusher() {
  if (flusherTimer) {
    clearInterval(flusherTimer);
    flusherTimer = null;
  }
}

export const USAGE_QUEUE_KEY = QUEUE_KEY;
