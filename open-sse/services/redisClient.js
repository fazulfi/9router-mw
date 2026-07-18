/**
 * 9router-mw Redis client (Fase 4).
 * Dedicated instance only: REDIS_URL or REDIS_HOST:6381 (never 6379/6380).
 * Fail-open: callers must treat null/timeout as degraded local mode.
 */

import Redis from "ioredis";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 6381;
const DEFAULT_DB = 0;
const CONNECT_TIMEOUT_MS = 1_500;
const COMMAND_TIMEOUT_MS = 1_000;
const MAX_RETRIES_PER_REQUEST = 1;

/** @type {import("ioredis").default | null} */
let client = null;
/** @type {boolean} */
let connectAttempted = false;
/** @type {string | null} */
let lastError = null;
/** @type {number} */
let lastPingMs = -1;

function resolveRedisOptions() {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    return {
      url,
      options: {
        maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
        enableOfflineQueue: false,
        connectTimeout: CONNECT_TIMEOUT_MS,
        commandTimeout: COMMAND_TIMEOUT_MS,
        lazyConnect: true,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 1_000);
        },
      },
    };
  }

  const host = process.env.REDIS_HOST?.trim() || DEFAULT_HOST;
  const port = Number(process.env.REDIS_PORT || DEFAULT_PORT);
  const password = process.env.REDIS_PASSWORD || undefined;
  const db = Number(process.env.REDIS_DB || DEFAULT_DB);

  return {
    url: null,
    options: {
      host,
      port: Number.isFinite(port) ? port : DEFAULT_PORT,
      password,
      db: Number.isFinite(db) ? db : DEFAULT_DB,
      maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
      enableOfflineQueue: false,
      connectTimeout: CONNECT_TIMEOUT_MS,
      commandTimeout: COMMAND_TIMEOUT_MS,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 1_000);
      },
    },
  };
}

/**
 * Get shared Redis client (lazy). Returns null if connect fails (fail-open).
 * @returns {Promise<import("ioredis").default | null>}
 */
export async function getRedis() {
  if (client && client.status === "ready") return client;
  if (client && (client.status === "connecting" || client.status === "connect")) {
    try {
      await client.connect().catch(() => {});
      if (client.status === "ready") return client;
    } catch {
      /* fall through */
    }
  }

  if (connectAttempted && client && client.status !== "ready") {
    return null;
  }

  connectAttempted = true;
  const { url, options } = resolveRedisOptions();

  try {
    client = url ? new Redis(url, options) : new Redis(options);
    client.on("error", (err) => {
      lastError = err?.message || String(err);
    });
    client.on("end", () => {
      /* allow reconnect on next getRedis */
    });

    if (client.status !== "ready") {
      await client.connect();
    }
    lastError = null;
    return client;
  } catch (err) {
    lastError = err?.message || String(err);
    try {
      client?.disconnect(false);
    } catch {
      /* ignore */
    }
    client = null;
    return null;
  }
}

/**
 * Force reconnect attempt (e.g. after Redis recovery).
 */
export function resetRedisClient() {
  try {
    client?.disconnect(false);
  } catch {
    /* ignore */
  }
  client = null;
  connectAttempted = false;
  lastError = null;
  lastPingMs = -1;
}

/**
 * @returns {Promise<{ ok: boolean, latencyMs: number, error: string | null, mode: "redis" | "degraded" }>}
 */
export async function pingRedis() {
  const start = Date.now();
  const r = await getRedis();
  if (!r) {
    return { ok: false, latencyMs: -1, error: lastError || "redis_unavailable", mode: "degraded" };
  }
  try {
    const pong = await r.ping();
    lastPingMs = Date.now() - start;
    const ok = pong === "PONG";
    return {
      ok,
      latencyMs: lastPingMs,
      error: ok ? null : `unexpected_pong:${pong}`,
      mode: ok ? "redis" : "degraded",
    };
  } catch (err) {
    lastError = err?.message || String(err);
    lastPingMs = Date.now() - start;
    return { ok: false, latencyMs: lastPingMs, error: lastError, mode: "degraded" };
  }
}

/**
 * Run fn(redis) with fail-open fallback.
 * @template T
 * @param {(redis: import("ioredis").default) => Promise<T>} fn
 * @param {() => T | Promise<T>} fallback
 * @returns {Promise<T>}
 */
export async function withRedis(fn, fallback) {
  const r = await getRedis();
  if (!r) return fallback();
  try {
    return await fn(r);
  } catch (err) {
    lastError = err?.message || String(err);
    return fallback();
  }
}

export function getRedisLastError() {
  return lastError;
}

export function getRedisLastPingMs() {
  return lastPingMs;
}

/**
 * Snapshot for /api/health (sync-ish; uses last known state).
 */
export function getRedisHealthSnapshot() {
  return {
    connected: Boolean(client && client.status === "ready"),
    status: client?.status || "disconnected",
    lastPingMs,
    lastError,
  };
}
