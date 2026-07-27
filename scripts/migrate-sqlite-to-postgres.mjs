import process from "node:process";
import { createBetterSqliteAdapter } from "../src/lib/db/adapters/betterSqliteAdapter.js";
import { createPgAdapter, createPgPool } from "../src/lib/db/adapters/pgAdapter.js";
import { ensurePostgresSchema } from "../src/lib/db/adapters/pgSchema.js";
import { migrateSqliteToPostgres } from "../src/lib/db/postgresMigration.js";

const sqliteFile = process.env.SQLITE_SOURCE_FILE?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!sqliteFile) throw new Error("SQLITE_SOURCE_FILE is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const source = createBetterSqliteAdapter(sqliteFile, { readOnly: true });
const pool = await createPgPool(databaseUrl, {
  max: 2,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000,
});
const target = createPgAdapter({ pool });

try {
  await ensurePostgresSchema(target);
  const result = await migrateSqliteToPostgres({ source, target });
  const rows = Object.values(result.tables).reduce((sum, table) => sum + table.target, 0);
  console.log(`SQLite to PostgreSQL migration verified: ${Object.keys(result.tables).length} tables, ${rows} rows`);
} finally {
  await Promise.resolve(source.close());
  await target.close();
}
