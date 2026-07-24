/**
 * 9router-mw Dedicated SQLite Writer (DB8).
 *
 * Standalone ESM process forked by custom-server.js (cluster primary).
 * Owns the WRITE connection to SQLite; workers enqueue usage events via Redis.
 *
 * Architecture:
 *   Worker → enqueueUsageEvent() → Redis list (mw:usage:queue)
 *   Writer ← drainUsageBatch() ← Redis list
 *   Writer → batch INSERT → SQLite (better-sqlite3, WAL)
 *
 * Import constraint: NO @/ aliases — this runs via raw Node ESM, not Next bundler.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { PRAGMA_SQL, TABLES, buildCreateTableSql } from "./src/lib/db/schema.js";
import { startUsageFlusher, stopUsageFlusher } from "./open-sse/services/usageBuffer.js";
import { getRedis } from "./open-sse/services/redisClient.js";
import { getAppVersion, timestampSlug } from "./src/lib/db/version.js";
import { parseJson, stringifyJson } from "./src/lib/db/helpers/jsonCol.js";
import { calculateCostFromTokens, getPricingForModel } from "./open-sse/providers/pricing.js";

// ─── 1b. Inline DATA_DIR + path logic ───────────────────────────
const APP_NAME = "9router";

function resolveDataDir() {
  const configured = process.env.DATA_DIR;
  if (configured) {
    try {
      fs.mkdirSync(configured, { recursive: true });
      return configured;
    } catch (e) {
      if (e?.code === "EACCES" || e?.code === "EPERM") {
        console.warn(`[writer] DATA_DIR '${configured}' not writable, fallback to default`);
      } else throw e;
    }
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

const DATA_DIR = resolveDataDir();
const DB_DIR = path.join(DATA_DIR, "db");
const DATA_FILE = path.join(DB_DIR, "data.sqlite");
const BACKUPS_DIR = path.join(DB_DIR, "backups");
fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// ─── 1c. Adapter shim (inline dari betterSqliteAdapter.js) ──────
const db = new Database(DATA_FILE, { timeout: 5000 });
db.exec(PRAGMA_SQL);

const stmtCache = new Map();
function prepare(sql) {
  let stmt = stmtCache.get(sql);
  if (!stmt) { stmt = db.prepare(sql); stmtCache.set(sql, stmt); }
  return stmt;
}
function adapterRun(sql, params = []) { return prepare(sql).run(...params); }
function adapterGet(sql, params = []) { return prepare(sql).get(...params); }
function adapterAll(sql, params = []) { return prepare(sql).all(...params); }
function adapterExec(sql) { return db.exec(sql); }
function adapterTransaction(fn) { return db.transaction(fn)(); }

// ─── 1d. Create tables ──────────────────────────────────────────
for (const [tableName, def] of Object.entries(TABLES)) {
  adapterExec(buildCreateTableSql(tableName, def));
  for (const idx of def.indexes || []) {
    try { adapterExec(idx); } catch { /* idempotent */ }
  }
}

// ─── 1e. metaStore inline ───────────────────────────────────────
function getMeta(key, fallback = null) {
  const row = adapterGet(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}
function setMeta(key, value) {
  adapterRun(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}

// ─── 1f. Core flush function ────────────────────────────────────
let lastFlushTime = 0;
let lastFlushCount = 0;
let totalFlushed = 0;

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  const pricing = getPricingForModel(provider, model);
  if (!pricing) return 0;
  return calculateCostFromTokens(tokens, pricing);
}

async function flushUsageBatch(events) {
  let count = 0;
  for (const entry of events) {
    try {
      if (!entry.timestamp) entry.timestamp = new Date().toISOString();
      entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

      const tokens = entry.tokens || {};
      const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
      const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

      adapterTransaction(() => {
        adapterRun(
          `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.timestamp, entry.provider || null, entry.model || null,
            entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
            promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
            stringifyJson(tokens), stringifyJson({}),
          ]
        );

        const dateKey = getLocalDateKey(entry.timestamp);
        const row = adapterGet(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
        const day = row ? parseJson(row.data, {}) : {
          requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0,
          byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
        };
        aggregateEntryToDay(day, entry);
        adapterRun(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

        const cur = adapterGet(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
        const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
        adapterRun(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      });
      count++;
    } catch (e) {
      console.error(`[writer] flush entry failed:`, e.message);
    }
  }
  if (count > 0) {
    lastFlushTime = Date.now();
    lastFlushCount = count;
    totalFlushed += count;
  }
}

// ─── 1g. Main startup ───────────────────────────────────────────
console.log(`[writer] start pid=${process.pid} db=${DATA_FILE}`);

// Flush function wrapper untuk usageBuffer
const flushFn = async (events) => { await flushUsageBatch(events); };

startUsageFlusher(flushFn, { intervalMs: 2000, batchSize: 50 });

// Periodic checkpoint (60s)
setInterval(() => {
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
}, 60000).unref();

// Periodic ANALYZE + VACUUM (tiap 1 jam)
setInterval(() => {
  try { db.exec("ANALYZE"); } catch {}
  try {
    const pc = adapterGet("SELECT page_count AS pc FROM pragma_page_count");
    const fl = adapterGet("SELECT freelist_count AS fl FROM pragma_freelist_count");
    if (pc && fl && pc.pc > 0 && (fl.fl / pc.pc) > 0.1) {
      console.log("[writer] freelist >10%, vacuum");
      db.exec("VACUUM");
    }
  } catch {}
}, 3600000).unref();

// Periodic backup (tiap 24 jam, keep 3)
setInterval(() => {
  try {
    const ver = getAppVersion();
    const slug = timestampSlug();
    const backupDir = path.join(BACKUPS_DIR, `writer-auto-${ver}-${slug}`);
    fs.mkdirSync(backupDir, { recursive: true });
    db.backup(path.join(backupDir, "data.sqlite"));
    const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, full: path.join(BACKUPS_DIR, e.name), mtime: fs.statSync(path.join(BACKUPS_DIR, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of entries.slice(3)) {
      fs.rmSync(old.full, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("[writer] backup failed:", e.message);
  }
}, 86400000).unref();

// Periodic health publish to Redis (cross-process visibility)
setInterval(async () => {
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.set("mw:writer:health", JSON.stringify({
        pid: process.pid,
        uptime: process.uptime(),
        ok: true,
        lastFlushAt: lastFlushTime ? new Date(lastFlushTime).toISOString() : null,
        lastFlushCount: lastFlushCount,
        totalFlushed: totalFlushed,
        db: {
          driver: "better-sqlite3",
          file: DATA_FILE,
          journalMode: db.pragma("journal_mode", true)?.[0],
        },
      }), "EX", 15);
    }
  } catch {}
}, 10000).unref();

// Signal ke parent (custom-server.js) bahwa writer siap
if (process.send) process.send({ type: "writer:ready", pid: process.pid });

// ─── 1h. IPC message handlers ───────────────────────────────────
process.on("message", (msg) => {
  if (msg?.type === "writer:ping") {
    if (process.send) {
      process.send({
        type: "writer:pong",
        pid: process.pid,
        uptime: process.uptime(),
        db: {
          driver: "better-sqlite3",
          file: DATA_FILE,
          journalMode: db.pragma("journal_mode", true)?.[0],
        },
      });
    }
  } else if (msg?.type === "shutdown") {
    shutdown();
  }
});

// ─── Graceful shutdown ──────────────────────────────────────────
function shutdown() {
  console.log("[writer] shutting down...");
  stopUsageFlusher();
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
  try { stmtCache.clear(); } catch {}
  try { db.close(); } catch {}
  // Clear Redis health key
  getRedis().then(redis => {
    if (redis) redis.del("mw:writer:health").catch(() => {});
  }).catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
