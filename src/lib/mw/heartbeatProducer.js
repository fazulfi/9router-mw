import cluster from "node:cluster";

export const HEARTBEAT_KEY_PREFIX = "mw:worker:heartbeat:";
export const HEARTBEAT_TTL_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_SCHEMA_VERSION = 1;

function safeError(onError, error) {
  if (typeof onError !== "function") return;
  try {
    onError(error);
  } catch {
    // Error observers must never interrupt heartbeat production.
  }
}

export function createWorkerHeartbeat(
  redis,
  {
    workerId,
    ttlMs = HEARTBEAT_TTL_MS,
    intervalMs = HEARTBEAT_INTERVAL_MS,
    onError,
  } = {},
) {
  if (cluster.isPrimary) {
    throw new Error("Refusing to start worker heartbeat in the primary process");
  }

  const id = String(workerId ?? "").trim();
  if (!id) throw new Error("Worker heartbeat requires a worker id");
  if (!redis || typeof redis.set !== "function") {
    throw new Error("Worker heartbeat requires a Redis client");
  }

  const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, 30_000) : HEARTBEAT_TTL_MS;
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : HEARTBEAT_INTERVAL_MS;
  const key = `${HEARTBEAT_KEY_PREFIX}${id}`;
  let timer = null;
  let started = false;

  const writeHeartbeat = () => {
    const payload = JSON.stringify({
      workerId: id,
      status: "ready",
      observedAt: Date.now(),
      schemaVersion: HEARTBEAT_SCHEMA_VERSION,
    });
    Promise.resolve(redis.set(key, payload, "PX", safeTtlMs)).catch((error) => {
      safeError(onError, error);
    });
  };

  return {
    start() {
      if (started) return;
      started = true;
      writeHeartbeat();
      timer = setInterval(writeHeartbeat, safeIntervalMs);
      if (typeof timer.unref === "function") timer.unref();
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      started = false;
    },
  };
}
