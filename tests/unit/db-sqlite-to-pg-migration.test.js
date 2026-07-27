import { describe, expect, it } from "vitest";

class SourceAdapter {
  constructor(tables) {
    this.tables = tables;
  }

  all(sql) {
    const table = sql.match(/FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    return this.tables[table] || [];
  }
}

class TargetAdapter {
  constructor() {
    this.log = [];
    this.counts = new Map();
  }

  async transaction(fn) {
    this.log.push(["transaction", "begin"]);
    const result = await fn();
    this.log.push(["transaction", "commit"]);
    return result;
  }

  async exec(sql) {
    this.log.push(["exec", sql]);
  }

  async run(sql, params = []) {
    this.log.push(["run", sql, params]);
    const table = sql.match(/INSERT INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    if (table) this.counts.set(table, (this.counts.get(table) || 0) + 1);
    return { changes: 1 };
  }

  async get(sql) {
    const table = sql.match(/FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    return { count: this.counts.get(table) || 0 };
  }
}

describe("SQLite to PostgreSQL migration", () => {
  it("copies all supported tables transactionally and verifies row counts", async () => {
    const { migrateSqliteToPostgres } = await import("../../src/lib/db/postgresMigration.js");
    const source = new SourceAdapter({
      _meta: [{ key: "schemaVersion", value: "2" }],
      providerConnections: [{
        id: "conn-1",
        provider: "codex",
        authType: "oauth",
        isActive: 1,
        data: "encrypted",
        createdAt: "now",
        updatedAt: "now",
      }],
      usageHistory: [{ id: 41, timestamp: "now", promptTokens: 2, completionTokens: 3 }],
    });
    const target = new TargetAdapter();

    const result = await migrateSqliteToPostgres({ source, target });

    expect(result.tables.providerConnections).toEqual({ source: 1, target: 1 });
    expect(result.tables.usageHistory).toEqual({ source: 1, target: 1 });
    expect(target.log[0]).toEqual(["transaction", "begin"]);
    expect(target.log.at(-1)).toEqual(["transaction", "commit"]);
  });

  it("preserves encrypted text and explicit usage history IDs", async () => {
    const { migrateSqliteToPostgres } = await import("../../src/lib/db/postgresMigration.js");
    const source = new SourceAdapter({
      providerConnections: [{
        id: "conn-1",
        provider: "codex",
        authType: "oauth",
        data: "encrypted-token-payload",
        createdAt: "now",
        updatedAt: "now",
      }],
      usageHistory: [{ id: 88, timestamp: "now" }],
    });
    const target = new TargetAdapter();

    await migrateSqliteToPostgres({ source, target });

    const connectionInsert = target.log.find((entry) => entry[0] === "run" && /providerConnections/.test(entry[1]));
    const usageInsert = target.log.find((entry) => entry[0] === "run" && /usageHistory/.test(entry[1]));
    expect(connectionInsert[2]).toContain("encrypted-token-payload");
    expect(usageInsert[2][0]).toBe(88);
    expect(target.log.some((entry) => /setval/.test(entry[1] || ""))).toBe(true);
  });

  it("assigns deterministic IDs to legacy rows with null text primary keys", async () => {
    const { migrateSqliteToPostgres } = await import("../../src/lib/db/postgresMigration.js");
    const source = new SourceAdapter({
      combos: [{ migrationRowId: 7, id: null, name: "legacy", kind: "combo", models: "[]" }],
    });
    const target = new TargetAdapter();

    await migrateSqliteToPostgres({ source, target });

    const comboInsert = target.log.find((entry) => entry[0] === "run" && /INSERT INTO combos/.test(entry[1]));
    expect(comboInsert[2][0]).toBe("migration-combos-7");
  });

  it("fails the migration when target row counts diverge", async () => {
    const { migrateSqliteToPostgres } = await import("../../src/lib/db/postgresMigration.js");
    const source = new SourceAdapter({ settings: [{ id: 1, data: "{}" }] });
    const target = new TargetAdapter();
    target.get = async () => ({ count: 0 });

    await expect(migrateSqliteToPostgres({ source, target })).rejects.toThrow(
      "PostgreSQL row-count verification failed for settings",
    );
  });
});
