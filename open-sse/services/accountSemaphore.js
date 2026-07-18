/**
 * Cross-worker account semaphore (Fase 4).
 * Key: mw:sem:{accountId}
 * Atomic claim via Lua INCR + EXPIRE; fail-open to per-process Map.
 */

import { withRedis } from "./redisClient.js";

const KEY_PREFIX = "mw:sem:";
/** Default max concurrent claims per account across all workers */
const DEFAULT_MAX = 1;
/** Safety TTL so crashed workers release slots (2 min) */
const DEFAULT_TTL_SEC = 120;

/** @type {Map<string, number>} local degraded counters */
const localSem = new Map();

const ACQUIRE_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', key) or '0')
if cur >= max then
  return {0, cur}
end
cur = redis.call('INCR', key)
if cur == 1 then
  redis.call('EXPIRE', key, ttl)
elseif redis.call('TTL', key) < 0 then
  redis.call('EXPIRE', key, ttl)
end
return {1, cur}
`;

const RELEASE_LUA = `
local key = KEYS[1]
local cur = tonumber(redis.call('GET', key) or '0')
if cur <= 0 then
  redis.call('DEL', key)
  return 0
end
cur = redis.call('DECR', key)
if cur <= 0 then
  redis.call('DEL', key)
  return 0
end
return cur
`;

function semKey(accountId) {
  return `${KEY_PREFIX}${accountId}`;
}

/**
 * @param {string} accountId
 * @param {{ max?: number, ttlSec?: number }} [opts]
 * @returns {Promise<{ acquired: boolean, count: number, mode: "redis" | "local" }>}
 */
export async function acquireAccountSlot(accountId, opts = {}) {
  if (!accountId) {
    return { acquired: false, count: 0, mode: "local" };
  }
  const max = Math.max(1, Number(opts.max ?? process.env.MW_SEM_MAX ?? DEFAULT_MAX) || DEFAULT_MAX);
  const ttlSec = Math.max(5, Number(opts.ttlSec ?? process.env.MW_SEM_TTL_SEC ?? DEFAULT_TTL_SEC) || DEFAULT_TTL_SEC);
  const key = semKey(accountId);

  return withRedis(
    async (redis) => {
      const result = await redis.eval(ACQUIRE_LUA, 1, key, String(max), String(ttlSec));
      const acquired = Number(result?.[0]) === 1;
      const count = Number(result?.[1] || 0);
      return { acquired, count, mode: "redis" };
    },
    () => {
      const cur = localSem.get(accountId) || 0;
      if (cur >= max) {
        return { acquired: false, count: cur, mode: "local" };
      }
      const next = cur + 1;
      localSem.set(accountId, next);
      return { acquired: true, count: next, mode: "local" };
    },
  );
}

/**
 * @param {string} accountId
 * @returns {Promise<{ count: number, mode: "redis" | "local" }>}
 */
export async function releaseAccountSlot(accountId) {
  if (!accountId) {
    return { count: 0, mode: "local" };
  }
  const key = semKey(accountId);

  return withRedis(
    async (redis) => {
      const count = Number(await redis.eval(RELEASE_LUA, 1, key));
      return { count, mode: "redis" };
    },
    () => {
      const cur = localSem.get(accountId) || 0;
      if (cur <= 1) {
        localSem.delete(accountId);
        return { count: 0, mode: "local" };
      }
      const next = cur - 1;
      localSem.set(accountId, next);
      return { count: next, mode: "local" };
    },
  );
}

/**
 * Current slot count (best-effort).
 * @param {string} accountId
 */
export async function getAccountSlotCount(accountId) {
  if (!accountId) return { count: 0, mode: "local" };
  const key = semKey(accountId);
  return withRedis(
    async (redis) => {
      const raw = await redis.get(key);
      return { count: Number(raw || 0), mode: "redis" };
    },
    () => ({ count: localSem.get(accountId) || 0, mode: "local" }),
  );
}

/** Test helper: clear local degraded map */
export function resetLocalSemaphore() {
  localSem.clear();
}

export const ACCOUNT_SEM_KEY_PREFIX = KEY_PREFIX;
