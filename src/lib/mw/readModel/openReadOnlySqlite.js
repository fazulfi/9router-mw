/**
 * Open better-sqlite3 in strict readonly mode for MW provider summary.
 * Never runs migrations. Fail-closed → null when file missing or open fails.
 */

import fs from "node:fs";
import { DATA_FILE } from "@/lib/db/paths.js";

/**
 * @param {string} [filePath]
 * @returns {Promise<{ driver: string, readOnly: true, prepare: Function, close: Function } | null>}
 */
export async function openReadOnlySqlite(filePath = DATA_FILE) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(filePath, { readonly: true, fileMustExist: true });

    const stmtCache = new Map();
    function prepare(sql) {
      let stmt = stmtCache.get(sql);
      if (!stmt) {
        stmt = db.prepare(sql);
        stmtCache.set(sql, stmt);
      }
      return stmt;
    }

    return {
      driver: "better-sqlite3",
      readOnly: true,
      prepare,
      close() {
        try {
          stmtCache.clear();
        } catch {
          /* ignore */
        }
        try {
          db.close();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}
