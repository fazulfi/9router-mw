import crypto from "node:crypto";
import { encryptSecretJson } from "../helpers/secretCol.js";

export default {
  version: 2,
  name: "key-encryption",
  up(db) {
    // Add keyPrefix and keyHash columns (safe for re-run via IF NOT EXISTS pattern
    // via the column check — but ALTER TABLE ADD COLUMN is idempotent-fail, not
    // idempotent-skip, so we need the try/catch for existing DBs that already
    // have these columns from schema sync).
    const existingCols = db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name);
    const colSet = new Set(existingCols);

    if (!colSet.has("keyPrefix")) {
      db.run(`ALTER TABLE apiKeys ADD COLUMN keyPrefix TEXT DEFAULT ''`);
    }
    if (!colSet.has("keyHash")) {
      db.run(`ALTER TABLE apiKeys ADD COLUMN keyHash TEXT`);
    }

    // Backfill: for existing plaintext keys, compute hash, prefix, encrypt
    const rows = db.all(`SELECT id, key FROM apiKeys WHERE keyHash IS NULL`);
    for (const row of rows) {
      const prefix = row.key.slice(0, 12);
      const hash = crypto.createHash("sha256").update(row.key).digest("hex");
      const encrypted = encryptSecretJson({ k: row.key });
      db.run(`UPDATE apiKeys SET keyPrefix = ?, keyHash = ?, key = ? WHERE id = ?`, [
        prefix,
        hash,
        encrypted,
        row.id,
      ]);
    }

    // Add remaining columns (skip if already exist)
    if (!colSet.has("scope")) {
      db.run(
        `ALTER TABLE apiKeys ADD COLUMN scope TEXT DEFAULT '{"models":["*"],"providers":["*"],"maxDailySpend":null,"maxRatePerMin":null}'`,
      );
    }
    if (!colSet.has("keyVersion")) {
      db.run(`ALTER TABLE apiKeys ADD COLUMN keyVersion INTEGER DEFAULT 1`);
    }
    if (!colSet.has("rotationPolicy")) {
      db.run(`ALTER TABLE apiKeys ADD COLUMN rotationPolicy TEXT DEFAULT 'none'`);
    }
    if (!colSet.has("rotationDays")) {
      db.run(`ALTER TABLE apiKeys ADD COLUMN rotationDays INTEGER`);
    }
    if (!colSet.has("expiresAt")) {
      db.run(`ALTER TABLE apiKeys ADD COLUMN expiresAt TEXT`);
    }
    if (!colSet.has("rotatedFromId")) {
      db.run(
        `ALTER TABLE apiKeys ADD COLUMN rotatedFromId TEXT REFERENCES apiKeys(id)`,
      );
    }

    // Create apiKeyAudit table
    db.exec(`CREATE TABLE IF NOT EXISTS apiKeyAudit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apiKeyId TEXT NOT NULL,
      apiKeyHash TEXT,
      event TEXT NOT NULL,
      metadata TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // Create audit indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_aka_keyid ON apiKeyAudit(apiKeyId, timestamp DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_aka_event ON apiKeyAudit(event, timestamp DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_aka_hash ON apiKeyAudit(apiKeyHash, timestamp DESC)`);

    // Drop old key index if it exists (replaced by keyHash index from schema.js)
    try {
      db.exec(`DROP INDEX IF EXISTS idx_ak_key`);
    } catch {
      // Index may not exist — ignore
    }
  },
};
