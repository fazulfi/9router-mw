import Database from "better-sqlite3";
import { PRAGMA_SQL } from "../schema.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export function createBetterSqliteTransaction(db, assertWritable = () => {}) {
  let transactionSequence = 0;
  let pendingTransaction = null;

  function isThenable(value) {
    return value !== null
      && (typeof value === "object" || typeof value === "function")
      && typeof value.then === "function";
  }

  function rollbackSavepoint(savepoint) {
    let cleanupError = null;
    try {
      db.exec(`ROLLBACK TO ${savepoint}`);
    } catch (error) {
      cleanupError = error;
    }
    try {
      db.exec(`RELEASE ${savepoint}`);
    } catch (error) {
      cleanupError ||= error;
    }
    return cleanupError;
  }

  function runTransaction(fn) {
    const savepoint = `mw_tx_${++transactionSequence}`;
    db.exec(`SAVEPOINT ${savepoint}`);

    try {
      const result = fn();
      if (!isThenable(result)) {
        db.exec(`RELEASE ${savepoint}`);
        return result;
      }

      return Promise.resolve(result).then(
        (value) => {
          try {
            db.exec(`RELEASE ${savepoint}`);
          } catch (error) {
            rollbackSavepoint(savepoint);
            throw error;
          }
          return value;
        },
        (error) => {
          rollbackSavepoint(savepoint);
          throw error;
        }
      );
    } catch (error) {
      rollbackSavepoint(savepoint);
      throw error;
    }
  }

  function trackTransaction(result) {
    const tracked = Promise.resolve(result).finally(() => {
      if (pendingTransaction === tracked) pendingTransaction = null;
    });
    pendingTransaction = tracked;
    return tracked;
  }

  return function transaction(fn) {
    assertWritable();
    if (pendingTransaction) {
      return trackTransaction(pendingTransaction.then(
        () => runTransaction(fn),
        () => runTransaction(fn)
      ));
    }

    const result = runTransaction(fn);
    return isThenable(result) ? trackTransaction(result) : result;
  };
}

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

  const transaction = createBetterSqliteTransaction(db, assertWritable);

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
    transaction,
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
