const TABLE_COLUMNS = Object.freeze({
  _meta: ["key", "value"],
  settings: ["id", "data"],
  providerConnections: [
    "id", "provider", "authType", "name", "email", "priority", "isActive", "data", "createdAt", "updatedAt",
  ],
  providerNodes: ["id", "type", "name", "data", "createdAt", "updatedAt"],
  proxyPools: ["id", "isActive", "testStatus", "data", "createdAt", "updatedAt"],
  apiKeys: ["id", "key", "name", "machineId", "isActive", "createdAt"],
  combos: ["id", "name", "kind", "models", "createdAt", "updatedAt"],
  kv: ["scope", "key", "value"],
  usageHistory: [
    "id", "timestamp", "provider", "model", "connectionId", "apiKey", "endpoint", "promptTokens",
    "completionTokens", "cost", "status", "tokens", "meta",
  ],
  usageDaily: ["dateKey", "data"],
  requestDetails: [
    "id", "timestamp", "provider", "model", "connectionId", "apiKey", "apiKeyName", "status", "data",
  ],
});

function insertionSql(table, columns) {
  const placeholders = columns.map(() => "?").join(", ");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
}

const LEGACY_TEXT_PRIMARY_KEYS = Object.freeze({
  providerConnections: "id",
  providerNodes: "id",
  proxyPools: "id",
  apiKeys: "id",
  combos: "id",
  usageDaily: "dateKey",
  requestDetails: "id",
});

async function readSourceRows(source, table) {
  return Promise.resolve(source.all(`SELECT rowid AS migrationRowId, * FROM ${table}`));
}

function migrationValue(table, row, column) {
  const primaryKey = LEGACY_TEXT_PRIMARY_KEYS[table];
  if (column === primaryKey && (row[column] == null || row[column] === "")) {
    return `migration-${table}-${row.migrationRowId}`;
  }
  return row[column] ?? null;
}

export async function migrateSqliteToPostgres({ source, target }) {
  if (!source || typeof source.all !== "function") throw new TypeError("SQLite source adapter is required");
  if (!target || typeof target.transaction !== "function") throw new TypeError("PostgreSQL target adapter is required");

  const sourceRows = new Map();
  for (const table of Object.keys(TABLE_COLUMNS)) {
    sourceRows.set(table, await readSourceRows(source, table));
  }

  const tables = {};
  await target.transaction(async () => {
    for (const table of Object.keys(TABLE_COLUMNS).reverse()) {
      await target.exec(`DELETE FROM ${table}`);
    }

    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const rows = sourceRows.get(table);
      const sql = insertionSql(table, columns);
      for (const row of rows) {
        await target.run(sql, columns.map((column) => migrationValue(table, row, column)));
      }

      const countRow = await target.get(`SELECT COUNT(*) AS count FROM ${table}`);
      const targetCount = Number(countRow?.count ?? 0);
      if (targetCount !== rows.length) {
        throw new Error(`PostgreSQL row-count verification failed for ${table}: source=${rows.length}, target=${targetCount}`);
      }
      tables[table] = { source: rows.length, target: targetCount };
    }

    await target.exec(
      `SELECT setval(pg_get_serial_sequence('usageHistory', 'id'), COALESCE((SELECT MAX(id) FROM usageHistory), 1), (SELECT COUNT(*) > 0 FROM usageHistory))`,
    );
  });

  return { tables };
}

export { TABLE_COLUMNS };
