import { ensureDirs, DATA_FILE } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

/**
 * F6: production multi-worker must use native SQLite (better-sqlite3 / node:sqlite).
 * sql.js is banned when MW_REQUIRE_NATIVE_SQLITE is not "0" (default on in production).
 */
function requireNativeSqlite() {
  if (process.env.MW_REQUIRE_NATIVE_SQLITE === "0") return false;
  if (process.env.MW_REQUIRE_NATIVE_SQLITE === "1") return true;
  return process.env.NODE_ENV === "production";
}

async function initAdapter() {
  ensureDirs();
  const nativeOnly = requireNativeSqlite();
  // Order per runtime:
  //   Bun:  bun:sqlite → (sql.js only if native not required)
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → (sql.js only if native not required)
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter && !nativeOnly) adapter = await trySqlJs();
  if (!adapter) {
    if (nativeOnly) {
      throw new Error(
        "[DB] better-sqlite3/native SQLite required in production multi-worker " +
          "(set MW_REQUIRE_NATIVE_SQLITE=0 only for emergency local debug; sql.js banned)",
      );
    }
    throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");
  }

  if (nativeOnly && adapter.driver === "sql.js") {
    throw new Error("[DB] sql.js is banned in production multi-worker (MW_REQUIRE_NATIVE_SQLITE)");
  }

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
