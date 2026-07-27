import { describe, expect, it } from "vitest";

const driverSource = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../../src/lib/db/driver.js", import.meta.url), "utf8"),
);
const writerSource = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../../primary-writer.mjs", import.meta.url), "utf8"),
);
const packageJson = await import("../../package.json", { with: { type: "json" } }).then(({ default: value }) => value);
const nextConfigSource = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../../next.config.mjs", import.meta.url), "utf8"),
);
const releaseSource = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../../docs/runtime-deployment/runtime-release.sh", import.meta.url), "utf8"),
);
const migrationCliSource = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../../scripts/migrate-sqlite-to-postgres.mjs", import.meta.url), "utf8"),
).catch(() => "");

describe("PostgreSQL runtime selection", () => {
  it("selects PostgreSQL whenever DATABASE_URL is configured", () => {
    expect(driverSource).toContain("process.env.DATABASE_URL");
    expect(driverSource).toContain("createPgAdapter");
    expect(driverSource).toContain("createPgPool");
    expect(driverSource.indexOf("tryPostgres")).toBeLessThan(driverSource.indexOf("tryBetterSqlite"));
  });

  it("opens cluster-worker PostgreSQL adapters in read-only mode", () => {
    expect(driverSource).toMatch(/createPgAdapter\(\{[\s\S]*readOnly[\s\S]*\}\)/);
  });

  it("uses the PostgreSQL schema path instead of SQLite migrations", () => {
    expect(driverSource).toContain("ensurePostgresSchema");
    expect(driverSource).toMatch(/adapter\.driver === "postgresql"/);
  });

  it("allows the dedicated writer to use PostgreSQL without opening SQLite", () => {
    expect(writerSource).toContain("createPgPool");
    expect(writerSource).toContain("createPgAdapter");
    expect(writerSource).toContain("ensurePostgresSchema");
    expect(writerSource).toMatch(/if \(process\.env\.DATABASE_URL\)/);
  });

  it("packages PostgreSQL for standalone runtime artifacts", () => {
    expect(packageJson.dependencies.pg).toBeTruthy();
    expect(nextConfigSource).toMatch(/serverExternalPackages:[\s\S]*"pg"/);
    expect(releaseSource).toMatch(/for package in[\s\S]*\bpg\b/);
    expect(releaseSource).toContain('[[ -d "${artifact}/node_modules/pg" ]]');
  });

  it("provides a non-destructive SQLite to PostgreSQL migration command", () => {
    expect(migrationCliSource).toContain("migrateSqliteToPostgres");
    expect(migrationCliSource).toContain("ensurePostgresSchema");
    expect(migrationCliSource).toContain("createBetterSqliteAdapter");
    expect(migrationCliSource).toContain("readOnly: true");
    expect(migrationCliSource).not.toContain("console.log(process.env.DATABASE_URL");
  });

  it("migrates the isolated staging snapshot before starting PostgreSQL staging", () => {
    expect(releaseSource).toContain("STAGE_POSTGRES_ENV_FILE");
    expect(releaseSource).toContain("migrate_staging_database_to_postgres");
    expect(releaseSource).toContain('read_env_value "${STAGE_POSTGRES_ENV_FILE}" DATABASE_URL');
    expect(releaseSource).toContain("SQLITE_SOURCE_FILE");
    expect(releaseSource).toContain('migrate_staging_database_to_postgres "${artifact}" "${stage_database_url}"');
    expect(releaseSource).not.toContain('stage_database_url="$(migrate_staging_database_to_postgres');
    expect(releaseSource).not.toContain("printf '%s\\n' \"${stage_database_url}\"");
    expect(releaseSource).toContain("DATABASE_URL=${stage_database_url}");
    expect(releaseSource).toContain('database = hotpath.get("database") or hotpath.get("sqlite") or {}');
    expect(releaseSource).toContain('driver in {"better-sqlite3", "postgresql"}');
    expect(releaseSource.indexOf("migrate_staging_database_to_postgres")).toBeLessThan(
      releaseSource.indexOf('systemctl enable --now "${STAGE_SERVICE}"'),
    );
  });
});
