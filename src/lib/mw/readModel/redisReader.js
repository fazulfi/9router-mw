/**
 * MW Redis live-usage read-model (read-only dashboard).
 * Bounded SCAN + GET + LRANGE only — never KEYS / SMEMBERS.
 */

const ACTIVE_KEYS = ["connectionId", "model", "count"];
const RECENT_KEYS = [
  "timestamp",
  "provider",
  "model",
  "connectionId",
  "endpoint",
  "status",
  "tokens",
];

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function pick(obj, keys) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    return {};
  }
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      out[key] = obj[key];
    }
  }
  return out;
}

/**
 * Project a raw snapshot into an allowlisted DTO.
 * Strips secrets (apiKey, accessToken, credential, internalSecret).
 */
export function projectLiveSnapshot(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  return {
    mode: source.mode,
    active: Array.isArray(source.active)
      ? source.active.map((item) => pick(item, ACTIVE_KEYS))
      : [],
    recent: Array.isArray(source.recent)
      ? source.recent.map((item) => pick(item, RECENT_KEYS))
      : [],
    lastError: Object.prototype.hasOwnProperty.call(source, "lastError")
      ? source.lastError
      : null,
  };
}

/**
 * Read a bounded live snapshot from Redis.
 *
 * @param {object} redis - client with scan (async iterator), get, lrange
 * @param {{ scanCount: number, maxCounterKeys: number, recentLimit: number }} options
 */
export async function readRedisLiveSnapshot(redis, options = {}) {
  const { scanCount, maxCounterKeys, recentLimit } = options;

  if (
    !isPositiveNumber(scanCount) ||
    !isPositiveNumber(maxCounterKeys) ||
    !isPositiveNumber(recentLimit)
  ) {
    throw new Error("scan/recent budgets must be positive bounds (limit/budget)");
  }

  const counterKeys = [];
  for await (const [cursor, keys] of redis.scan("0", {
    MATCH: "mw:live:cnt:*",
    COUNT: scanCount,
  })) {
    void cursor;
    if (Array.isArray(keys)) {
      for (const key of keys) {
        if (counterKeys.length >= maxCounterKeys) break;
        counterKeys.push(key);
      }
    }
    if (counterKeys.length >= maxCounterKeys) break;
  }

  const active = [];
  for (const key of counterKeys) {
    const raw = await redis.get(key);
    const count = raw == null ? 0 : Number.parseInt(String(raw), 10);
    // key: mw:live:cnt:{connectionId}|{model}
    const prefix = "mw:live:cnt:";
    const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    const sep = rest.indexOf("|");
    const connectionId = sep === -1 ? rest : rest.slice(0, sep);
    const model = sep === -1 ? "" : rest.slice(sep + 1);
    active.push({
      connectionId,
      model,
      count: Number.isFinite(count) ? count : 0,
    });
  }

  const rawRecent = await redis.lrange("mw:live:recent", 0, recentLimit - 1);
  let mode = "redis";
  const recent = [];

  for (const entry of rawRecent || []) {
    if (typeof entry !== "string") {
      mode = "degraded";
      continue;
    }
    try {
      const parsed = JSON.parse(entry);
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        mode = "degraded";
        continue;
      }
      recent.push(pick(parsed, RECENT_KEYS));
    } catch {
      mode = "degraded";
      // skip malformed entry — do not include raw string
    }
  }

  let lastError = null;
  try {
    const errVal = await redis.get("mw:live:lastErr");
    if (errVal != null && errVal !== "") {
      lastError = String(errVal);
    }
  } catch {
    // Optional last-error is best-effort. Fail closed to a generic degraded
    // snapshot — never surface Redis error details to the dashboard DTO.
    mode = "degraded";
    lastError = null;
  }

  return projectLiveSnapshot({
    mode,
    active,
    recent,
    lastError,
  });
}
