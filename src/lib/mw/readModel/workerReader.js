const HEARTBEAT_KEY_PREFIX = "mw:worker:heartbeat:";
const HEARTBEAT_TTL_MS = 60_000;
const SUPPORTED_SCHEMA_VERSION = 1;
const DEFAULT_WORKER_COUNT = 4;
const SAFE_WORKER_FIELDS = ["workerId", "status", "observedAt", "ageMs"];
const FORBIDDEN_WORKER_FIELDS = [
  "host",
  "pid",
  "cpu",
  "memory",
  "hostname",
  "username",
  "loadAverage",
  "freeMem",
  "totalMem",
];

/**
 * Allowlisted aggregate fields exposed on the workers DTO at the
 * route boundary.  Never leak anything outside this list.
 */
export const SAFE_AGGREGATE_WORKER_FIELDS = Object.freeze([
  "availability",
  "expectedCount",
  "freshCount",
  "schemaVersion",
  "missingWorkerIds",
]);

/** Allowlisted per-worker fields (also enforced by pickSafeFields). */
export const SAFE_PER_WORKER_FIELDS = Object.freeze(SAFE_WORKER_FIELDS.slice());

function pickSafeFields(record) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const safe = {};
  for (const key of SAFE_WORKER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      safe[key] = record[key];
    }
  }
  return safe;
}

function isFreshHeartbeat(heartbeat, now, ttlMs) {
  if (!heartbeat || typeof heartbeat !== "object") return false;
  if (heartbeat.status !== "ready") return false;
  if (heartbeat.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return false;
  if (!Number.isFinite(heartbeat.observedAt)) return false;
  if (!Number.isFinite(now)) return false;
  const age = now - heartbeat.observedAt;
  if (age < 0 || age > ttlMs) return false;
  return true;
}

function parseHeartbeat(raw) {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Phase 1 single-heartbeat projection. Backward-compatible: returns
 * only an availability flag and optional schemaVersion, never per-worker
 * fields. New callers should use readWorkerObservability directly.
 */
export function projectWorkerObservability(heartbeat, { now = Date.now() } = {}) {
  if (!isFreshHeartbeat(heartbeat, now, HEARTBEAT_TTL_MS)) {
    return { availability: "unavailable" };
  }
  return {
    availability: "degraded",
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
  };
}

function buildUnavailable(expectedCount) {
  return {
    availability: "unavailable",
    expectedCount,
    freshCount: 0,
    workers: [],
    missingWorkerIds: [],
  };
}

function buildHealthy(workers) {
  return {
    availability: "ok",
    expectedCount: workers.length,
    freshCount: workers.length,
    workers,
    missingWorkerIds: [],
  };
}

function buildDegraded(workers) {
  return {
    availability: "degraded",
    expectedCount: workers.length,
    freshCount: workers.length,
    workers,
    missingWorkerIds: [],
  };
}

function buildPartial(workers, missingWorkerIds) {
  return {
    availability: "partial",
    expectedCount: workers.length + missingWorkerIds.length,
    freshCount: workers.length,
    workers,
    missingWorkerIds: missingWorkerIds.slice().sort(),
  };
}

/**
 * Per-worker heartbeat aggregation. Reads only bounded known-worker keys
 * via a single MGET (no KEYS, no SCAN, no SMEMBERS, no legacy single GET).
 *
 * @param {object|null} redis
 * @param {{ now?: number, workerCount?: number, ttlMs?: number }} [options]
 */
export async function readWorkerObservability(
  redis,
  { now = Date.now(), workerCount = DEFAULT_WORKER_COUNT, ttlMs = HEARTBEAT_TTL_MS } = {},
) {
  const expectedCount =
    Number.isFinite(workerCount) && workerCount > 0 ? Math.min(workerCount, 16) : DEFAULT_WORKER_COUNT;
  const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : HEARTBEAT_TTL_MS;

  if (!redis || typeof redis.mget !== "function") {
    return buildUnavailable(expectedCount);
  }

  const keys = [];
  for (let i = 1; i <= expectedCount; i += 1) {
    keys.push(`${HEARTBEAT_KEY_PREFIX}${i}`);
  }

  let rawValues;
  try {
    rawValues = await redis.mget(...keys);
  } catch {
    return buildUnavailable(expectedCount);
  }

  const workers = [];
  const missingWorkerIds = [];

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const raw = Array.isArray(rawValues) ? rawValues[i] : null;
    const workerId = key.slice(HEARTBEAT_KEY_PREFIX.length);
    const parsed = parseHeartbeat(raw);
    if (parsed == null || !isFreshHeartbeat(parsed, now, safeTtlMs)) {
      missingWorkerIds.push(workerId);
      continue;
    }
    const safe = pickSafeFields({
      workerId: parsed.workerId,
      status: parsed.status,
      observedAt: parsed.observedAt,
      ageMs: now - parsed.observedAt,
    });
    if (!safe) {
      missingWorkerIds.push(workerId);
      continue;
    }
    for (const forbidden of FORBIDDEN_WORKER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(safe, forbidden)) {
        delete safe[forbidden];
      }
    }
    workers.push(safe);
  }

  if (workers.length === expectedCount) return buildHealthy(workers);
  if (workers.length === 0) return buildUnavailable(expectedCount);
  return buildPartial(workers, missingWorkerIds);
}
