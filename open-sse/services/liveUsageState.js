/**
 * Cross-worker live usage state (pending counters + recent ring).
 * Fixes dashboard flicker under multi-worker: RECENT REQUESTS / active must be global.
 *
 * Keys (Redis :6381 only):
 *   mw:live:cnt:{connectionId}|{modelKey}  — INCR/DECR counter, TTL 60s
 *   mw:live:active                         — SET of active field keys
 *   mw:live:recent                         — LIST of JSON entries (cap 50)
 *   mw:live:lastErr                        — STRING provider (TTL 10s)
 *
 * Fail-open: local Map/array fallback when Redis unavailable.
 */

import { withRedis } from "./redisClient.js";

const CNT_PREFIX = "mw:live:cnt:";
const ACTIVE_SET = "mw:live:active";
const RECENT_LIST = "mw:live:recent";
const LAST_ERR_KEY = "mw:live:lastErr";
const PENDING_TTL_SEC = 60;
const RING_CAP = 50;
const LAST_ERR_TTL_SEC = 10;

/** @type {Map<string, number>} field -> count (local degraded) */
const localPending = new Map();
/** @type {object[]} */
const localRecent = [];
/** @type {{ provider: string, ts: number }} */
const localLastErr = { provider: "", ts: 0 };

function fieldKey(connectionId, modelKey) {
  const cid = connectionId || "_none";
  return `${cid}|${modelKey}`;
}

function parseField(field) {
  const idx = field.indexOf("|");
  if (idx < 0) return { connectionId: "", modelKey: field };
  return { connectionId: field.slice(0, idx), modelKey: field.slice(idx + 1) };
}

/**
 * +1 / -1 pending counter for one model/account pair.
 * Fire-and-forget safe (returns Promise; callers may ignore).
 * @param {string} modelKey  e.g. "gpt-4 (openai)"
 * @param {string|null} connectionId
 * @param {boolean} started
 * @param {{ error?: boolean, provider?: string }} [opts]
 */
export async function adjustPending(modelKey, connectionId, started, opts = {}) {
  const field = fieldKey(connectionId, modelKey);
  const delta = started ? 1 : -1;
  const cntKey = `${CNT_PREFIX}${field}`;

  if (!started && opts.error && opts.provider) {
    void setLastErrorProvider(opts.provider);
  }

  return withRedis(
    async (redis) => {
      if (started) {
        const multi = redis.multi();
        multi.incr(cntKey);
        multi.expire(cntKey, PENDING_TTL_SEC);
        multi.sadd(ACTIVE_SET, field);
        multi.expire(ACTIVE_SET, PENDING_TTL_SEC * 2);
        const res = await multi.exec();
        const count = Number(res?.[0]?.[1] || 0);
        return { count, mode: "redis" };
      }
      const multi = redis.multi();
      multi.decr(cntKey);
      const res = await multi.exec();
      let count = Number(res?.[0]?.[1] || 0);
      if (!Number.isFinite(count) || count <= 0) {
        await redis.del(cntKey);
        await redis.srem(ACTIVE_SET, field);
        count = 0;
      } else {
        await redis.expire(cntKey, PENDING_TTL_SEC);
      }
      return { count, mode: "redis" };
    },
    () => {
      const cur = localPending.get(field) || 0;
      const next = Math.max(0, cur + delta);
      if (next === 0) localPending.delete(field);
      else localPending.set(field, next);
      return { count: next, mode: "local" };
    },
  );
}

/**
 * Snapshot pending counters as { byModel, byAccount } matching usageRepo shape.
 * @returns {Promise<{ byModel: Record<string, number>, byAccount: Record<string, Record<string, number>>, mode: string }>}
 */
export async function getPendingSnapshot() {
  return withRedis(
    async (redis) => {
      const fields = await redis.smembers(ACTIVE_SET);
      const byModel = {};
      const byAccount = {};
      if (!fields?.length) {
        return { byModel, byAccount, mode: "redis" };
      }

      const pipeline = redis.pipeline();
      for (const f of fields) pipeline.get(`${CNT_PREFIX}${f}`);
      const results = await pipeline.exec();

      const stale = [];
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const raw = results?.[i]?.[1];
        const count = Math.max(0, Number(raw || 0));
        if (!count) {
          stale.push(field);
          continue;
        }
        const { connectionId, modelKey } = parseField(field);
        byModel[modelKey] = (byModel[modelKey] || 0) + count;
        if (connectionId && connectionId !== "_none") {
          if (!byAccount[connectionId]) byAccount[connectionId] = {};
          byAccount[connectionId][modelKey] = (byAccount[connectionId][modelKey] || 0) + count;
        }
      }

      if (stale.length) {
        const clean = redis.pipeline();
        for (const f of stale) {
          clean.srem(ACTIVE_SET, f);
          clean.del(`${CNT_PREFIX}${f}`);
        }
        await clean.exec().catch(() => {});
      }

      return { byModel, byAccount, mode: "redis" };
    },
    () => {
      const byModel = {};
      const byAccount = {};
      for (const [field, count] of localPending.entries()) {
        if (count <= 0) continue;
        const { connectionId, modelKey } = parseField(field);
        byModel[modelKey] = (byModel[modelKey] || 0) + count;
        if (connectionId && connectionId !== "_none") {
          if (!byAccount[connectionId]) byAccount[connectionId] = {};
          byAccount[connectionId][modelKey] = (byAccount[connectionId][modelKey] || 0) + count;
        }
      }
      return { byModel, byAccount, mode: "local" };
    },
  );
}

/**
 * Push a completed request entry onto the global recent ring.
 * @param {object} entry
 */
export async function pushRecentEntry(entry) {
  const slim = {
    timestamp: entry.timestamp || new Date().toISOString(),
    provider: entry.provider || "",
    model: entry.model || "",
    connectionId: entry.connectionId || null,
    apiKey: entry.apiKey || null,
    endpoint: entry.endpoint || null,
    cost: entry.cost || 0,
    status: entry.status || "ok",
    tokens: entry.tokens || {},
  };
  const payload = JSON.stringify(slim);

  return withRedis(
    async (redis) => {
      await redis.lpush(RECENT_LIST, payload);
      await redis.ltrim(RECENT_LIST, 0, RING_CAP - 1);
      return { mode: "redis" };
    },
    () => {
      localRecent.unshift(slim);
      if (localRecent.length > RING_CAP) localRecent.length = RING_CAP;
      return { mode: "local" };
    },
  );
}

/**
 * @returns {Promise<object[]>} newest-first
 */
export async function getRecentEntries() {
  return withRedis(
    async (redis) => {
      const rows = await redis.lrange(RECENT_LIST, 0, RING_CAP - 1);
      const items = [];
      for (const raw of rows || []) {
        try {
          items.push(JSON.parse(raw));
        } catch {
          /* skip corrupt */
        }
      }
      return items;
    },
    () => localRecent.slice(),
  );
}

/**
 * @param {string} provider
 */
export async function setLastErrorProvider(provider) {
  const p = String(provider || "").toLowerCase();
  if (!p) return;
  localLastErr.provider = p;
  localLastErr.ts = Date.now();
  return withRedis(
    async (redis) => {
      await redis.set(LAST_ERR_KEY, p, "EX", LAST_ERR_TTL_SEC);
      return { mode: "redis" };
    },
    () => ({ mode: "local" }),
  );
}

/**
 * @returns {Promise<string>} provider id or ""
 */
export async function getLastErrorProvider() {
  return withRedis(
    async (redis) => {
      const v = await redis.get(LAST_ERR_KEY);
      return v || "";
    },
    () => {
      if (Date.now() - localLastErr.ts < LAST_ERR_TTL_SEC * 1000) return localLastErr.provider;
      return "";
    },
  );
}
