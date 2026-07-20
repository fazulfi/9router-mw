/**
 * Composition helpers for MW dashboard deps (redis / sqlite / usage).
 * Testable via vi.mock("@/lib/mw/deps") or by injecting into create*Handler.
 */

const REDIS_BOUNDS = Object.freeze({
  scanCount: 25,
  maxCounterKeys: 50,
  recentLimit: 50,
});

const USAGE_PERIODS = Object.freeze(new Set(["24h", "7d", "30d"]));

/**
 * Wrap an ioredis client so scan yields async-iterator pairs expected by redisReader.
 * @param {import("ioredis").default | null} redis
 */
export function adaptIoredisScan(redis) {
  if (!redis) return null;
  if (typeof redis.scan !== "function") return redis;

  return {
    get: (...args) => redis.get(...args),
    lrange: (...args) => redis.lrange(...args),
    async *scan(cursor, { MATCH, COUNT } = {}) {
      let c = String(cursor ?? "0");
      do {
        const [next, keys] = await redis.scan(c, "MATCH", MATCH, "COUNT", COUNT);
        yield [next, keys];
        c = String(next);
      } while (c !== "0");
    },
  };
}

/**
 * Lazy Redis client for production MW routes. Fail-open → null.
 * @returns {Promise<object | null>}
 */
export async function getMwRedis() {
  try {
    const { getRedis } = await import("open-sse/services/redisClient.js");
    const client = await getRedis();
    return adaptIoredisScan(client);
  } catch {
    return null;
  }
}

/**
 * Lazy read-only SQLite adapter. Never migrates. Fail-closed → null.
 * @returns {Promise<object | null>}
 */
export async function getMwReadOnlySqlite() {
  try {
    const { openReadOnlySqlite } = await import("@/lib/mw/readModel/openReadOnlySqlite.js");
    return await openReadOnlySqlite();
  } catch {
    return null;
  }
}

/**
 * Project getUsageStats into allowlisted aggregate fields only.
 * @param {string} period
 */
export async function getMwUsageStats(period) {
  const safePeriod = USAGE_PERIODS.has(period) ? period : "24h";
  try {
    const { getUsageStats } = await import("@/lib/usageDb.js");
    const raw = await getUsageStats(safePeriod);
    return projectUsageStats(raw, safePeriod);
  } catch {
    return projectUsageStats(null, safePeriod);
  }
}

/**
 * Strip secrets / raw rows from usage stats for MW dashboard.
 *
 * totalTokens is derived from totalPromptTokens + totalCompletionTokens so
 * the projection works against the existing getUsageStats() aggregate
 * (which exposes prompt/completion but not a pre-summed total).
 */
export function projectUsageStats(raw, period = "24h") {
  const source = raw && typeof raw === "object" ? raw : {};
  const prompt = Number(source.totalPromptTokens) || 0;
  const completion = Number(source.totalCompletionTokens) || 0;
  return {
    period,
    totalRequests: Number(source.totalRequests) || 0,
    totalTokens: prompt + completion,
    successCount: Number(source.successCount) || 0,
    errorCount: Number(source.errorCount) || 0,
  };
}

export function getRedisBounds() {
  return { ...REDIS_BOUNDS };
}

export function isAllowedUsagePeriod(period) {
  return USAGE_PERIODS.has(period);
}

export { REDIS_BOUNDS, USAGE_PERIODS };
