/**
 * Pure DTO sanitization for MW companion SPA.
 * Never render secret field names/values from hostile fixtures.
 */

export const SECRET_KEY_PATTERN =
  /^(apiKey|accessToken|credential|password|internalSecret)$/i;

export const SECRET_KEY_SUBSTRINGS = [
  "apikey",
  "accesstoken",
  "credential",
  "password",
  "internalsecret",
];

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretKey(key) {
  if (typeof key !== "string" || key.length === 0) return false;
  if (SECRET_KEY_PATTERN.test(key)) return true;
  const lower = key.toLowerCase().replace(/[_-]/g, "");
  return SECRET_KEY_SUBSTRINGS.some(
    (part) => lower === part || lower.endsWith(part) || lower.startsWith(part),
  );
}

/**
 * Deep-strip secret keys from any JSON-like value.
 * Arrays and plain objects are walked; primitives pass through.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function stripSecrets(value, depth = 0) {
  if (depth > 12) return null;
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripSecrets(item, depth + 1));
  }
  if (typeof value !== "object") return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key)) continue;
    out[key] = stripSecrets(child, depth + 1);
  }
  return out;
}

/**
 * True if a stringified payload still contains secret key markers.
 * Used by tests and defensive UI guards.
 * @param {unknown} value
 * @returns {boolean}
 */
export function containsSecretMarkers(value) {
  try {
    const text = JSON.stringify(value);
    if (!text) return false;
    return /apiKey|accessToken|credential|password|internalSecret/i.test(text);
  } catch {
    return false;
  }
}

/** Allowlisted redis live-row fields (mirrors backend projectLiveSnapshot). */
export const REDIS_ACTIVE_KEYS = Object.freeze([
  "connectionId",
  "model",
  "count",
]);

export const REDIS_RECENT_KEYS = Object.freeze([
  "timestamp",
  "provider",
  "model",
  "connectionId",
  "endpoint",
  "status",
  "tokens",
]);

/**
 * @param {Record<string, unknown>|null|undefined} obj
 * @param {readonly string[]} keys
 * @returns {Record<string, unknown>}
 */
export function pickAllowlisted(obj, keys) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    return {};
  }
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && !isSecretKey(key)) {
      out[key] = obj[key];
    }
  }
  return out;
}

/**
 * Project a redis live snapshot for UI rendering.
 * @param {unknown} raw
 * @returns {{ mode: string|null, active: object[], recent: object[], lastError: unknown }}
 */
export function sanitizeRedisSnapshot(raw) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cleaned = stripSecrets(source);
  return {
    mode: typeof cleaned.mode === "string" ? cleaned.mode : null,
    active: Array.isArray(cleaned.active)
      ? cleaned.active.map((item) => pickAllowlisted(item, REDIS_ACTIVE_KEYS))
      : [],
    recent: Array.isArray(cleaned.recent)
      ? cleaned.recent.map((item) => pickAllowlisted(item, REDIS_RECENT_KEYS))
      : [],
    lastError: Object.prototype.hasOwnProperty.call(cleaned, "lastError")
      ? cleaned.lastError
      : null,
  };
}

/**
 * Project workers DTO — availability text only; never invent PIDs/metrics.
 * @param {unknown} raw
 * @returns {{ availability: 'unavailable'|'degraded'|string, schemaVersion?: unknown }}
 */
export function sanitizeWorkersDto(raw) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cleaned = stripSecrets(source);
  const availability =
    typeof cleaned.availability === "string" && cleaned.availability
      ? cleaned.availability
      : "unavailable";
  const out = { availability };
  if (cleaned.schemaVersion != null) {
    out.schemaVersion = cleaned.schemaVersion;
  }
  return out;
}

/**
 * Project usage aggregates to safe numeric fields.
 * @param {unknown} raw
 * @returns {{ period: string, totalRequests: number, totalTokens: number, successCount: number, errorCount: number }}
 */
export function sanitizeUsageDto(raw) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cleaned = stripSecrets(source);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    period: typeof cleaned.period === "string" ? cleaned.period : "24h",
    totalRequests: num(cleaned.totalRequests),
    totalTokens: num(cleaned.totalTokens),
    successCount: num(cleaned.successCount),
    errorCount: num(cleaned.errorCount),
  };
}

/**
 * Project providers list — strip secrets, keep display fields.
 * @param {unknown} raw
 * @returns {{ providers: object[], mode: string }}
 */
export function sanitizeProvidersDto(raw) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cleaned = stripSecrets(source);
  return {
    providers: Array.isArray(cleaned.providers)
      ? cleaned.providers.map((p) => stripSecrets(p))
      : [],
    mode: typeof cleaned.mode === "string" ? cleaned.mode : "degraded",
  };
}

/**
 * Project overview composition.
 * @param {unknown} raw
 */
export function sanitizeOverviewDto(raw) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cleaned = stripSecrets(source);
  const redis =
    cleaned.redis && typeof cleaned.redis === "object" ? cleaned.redis : {};
  const workers =
    cleaned.workers && typeof cleaned.workers === "object"
      ? cleaned.workers
      : {};
  return {
    redis: {
      mode: typeof redis.mode === "string" ? redis.mode : "degraded",
      activeCount: Number.isFinite(Number(redis.activeCount))
        ? Number(redis.activeCount)
        : 0,
      recentCount: Number.isFinite(Number(redis.recentCount))
        ? Number(redis.recentCount)
        : 0,
      lastError: redis.lastError ?? null,
    },
    workers: {
      availability:
        typeof workers.availability === "string" && workers.availability
          ? workers.availability
          : "unavailable",
    },
  };
}
