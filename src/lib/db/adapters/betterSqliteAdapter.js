import Database from "better-sqlite3";
import { PRAGMA_SQL } from "../schema.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export function createBetterSqliteAdapter(filePath, { readOnly = false } = {}) {
  const timeout = Number(process.env.DB_BUSY_TIMEOUT) || 15000;
  const db = new Database(filePath, {
    timeout,
    readonly: readOnly,
    fileMustExist: readOnly,
  });
  if (!readOnly) db.exec(PRAGMA_SQL);

  const stmtCache = new Map();

  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  function assertWritable() {
    if (readOnly) throw new Error("Cannot write through read-only SQLite adapter");
  }

  let checkpointTimer = null;
  if (!readOnly) {
    checkpointTimer = setInterval(() => {
      try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    }, CHECKPOINT_INTERVAL_MS);
    if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();
  }

  function gracefulClose() {
    if (!readOnly) {
      try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    }
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }

  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "better-sqlite3",
    readOnly,
    run(sql, params = []) { assertWritable(); return prepare(sql).run(...params); },
    get(sql, params = []) { return prepare(sql).get(...params); },
    all(sql, params = []) { return prepare(sql).all(...params); },
    exec(sql) { assertWritable(); return db.exec(sql); },
    transaction(fn) { assertWritable(); return db.transaction(fn)(); },
    checkpoint() {
      assertWritable();
      try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    },
    close() {
      if (checkpointTimer) clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
