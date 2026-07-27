import { describe, expect, it } from "vitest";

const expectedTables = [
  "_meta",
  "settings",
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "combos",
  "kv",
  "usageHistory",
  "usageDaily",
  "requestDetails",
];

describe("PostgreSQL schema", () => {
  it("defines every SQLite table without SQLite-only syntax", async () => {
    const { POSTGRES_SCHEMA_SQL } = await import("../../src/lib/db/adapters/pgSchema.js");

    for (const table of expectedTables) {
      expect(POSTGRES_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(POSTGRES_SCHEMA_SQL).not.toMatch(/\bPRAGMA\b|AUTOINCREMENT|INSERT OR REPLACE/i);
  });

  it("preserves repository-compatible text and integer column semantics", async () => {
    const { POSTGRES_SCHEMA_SQL } = await import("../../src/lib/db/adapters/pgSchema.js");

    expect(POSTGRES_SCHEMA_SQL).toContain("id BIGSERIAL PRIMARY KEY");
    expect(POSTGRES_SCHEMA_SQL).toContain("isActive INTEGER DEFAULT 1");
    expect(POSTGRES_SCHEMA_SQL).toContain("data TEXT NOT NULL");
    expect(POSTGRES_SCHEMA_SQL).toContain("PRIMARY KEY (scope, key)");
  });

  it("creates the usage dedup and query indexes", async () => {
    const { POSTGRES_SCHEMA_SQL } = await import("../../src/lib/db/adapters/pgSchema.js");

    expect(POSTGRES_SCHEMA_SQL).toContain("idx_uh_dedup");
    expect(POSTGRES_SCHEMA_SQL).toContain("idx_uh_ts");
    expect(POSTGRES_SCHEMA_SQL).toContain("idx_rd_ts");
  });
});
