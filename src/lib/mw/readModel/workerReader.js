const HEARTBEAT_KEY = "mw:worker:heartbeat";
const HEARTBEAT_TTL_MS = 60_000;
const SUPPORTED_SCHEMA_VERSION = 1;

function isSupportedHeartbeat(heartbeat, now) {
  if (!heartbeat || typeof heartbeat !== "object") return false;
  if (heartbeat.status !== "ready") return false;
  if (heartbeat.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return false;
  if (!Number.isFinite(heartbeat.observedAt)) return false;
  if (!Number.isFinite(now)) return false;
  return now - heartbeat.observedAt >= 0 && now - heartbeat.observedAt <= HEARTBEAT_TTL_MS;
}

export function projectWorkerObservability(heartbeat, { now = Date.now() } = {}) {
  if (!isSupportedHeartbeat(heartbeat, now)) {
    return { availability: "unavailable" };
  }

  return {
    availability: "degraded",
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
  };
}

export async function readWorkerObservability(redis, { now = Date.now() } = {}) {
  if (!redis || typeof redis.get !== "function") {
    return { availability: "unavailable" };
  }

  const rawHeartbeat = await redis.get(HEARTBEAT_KEY);
  if (rawHeartbeat == null) {
    return { availability: "unavailable" };
  }

  let heartbeat = rawHeartbeat;
  if (typeof rawHeartbeat === "string") {
    try {
      heartbeat = JSON.parse(rawHeartbeat);
    } catch {
      return { availability: "unavailable" };
    }
  }

  return projectWorkerObservability(heartbeat, { now });
}
