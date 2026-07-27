import { describe, expect, it, vi } from "vitest";

class FakeClient {
  constructor(log) {
    this.log = log;
    this.released = false;
  }

  async query(text, values = []) {
    this.log.push({ source: "client", text, values });
    if (text === "SELECT fail") throw new Error("query failed");
    return { rowCount: 1, rows: [{ id: "row-1" }] };
  }

  release(error) {
    this.released = true;
    this.releaseError = error;
  }
}

class FakePool {
  constructor() {
    this.log = [];
    this.clients = [];
    this.ended = false;
    this.errorHandler = null;
  }

  async query(text, values = []) {
    this.log.push({ source: "pool", text, values });
    return { rowCount: 1, rows: [{ id: "row-1" }] };
  }

  async connect() {
    const client = new FakeClient(this.log);
    this.clients.push(client);
    return client;
  }

  on(event, handler) {
    if (event === "error") this.errorHandler = handler;
  }

  async end() {
    this.ended = true;
  }
}

describe("PostgreSQL database adapter", () => {
  it("translates SQLite placeholders without changing question marks in literals", async () => {
    const { createPgAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const pool = new FakePool();
    const adapter = createPgAdapter({ pool });

    await adapter.get("SELECT '?' AS literal, id FROM items WHERE id = ? AND name = ?", [7, "name"]);

    expect(pool.log[0]).toEqual({
      source: "pool",
      text: "SELECT '?' AS literal, id FROM items WHERE id = $1 AND name = $2",
      values: [7, "name"],
    });
  });

  it("normalizes PostgreSQL field names to the existing repository contract", async () => {
    const { createPgAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const pool = new FakePool();
    pool.query = async () => ({
      rowCount: 1,
      rows: [{ authtype: "oauth", isactive: 1, createdat: "now", connectionid: "conn-1" }],
    });
    const adapter = createPgAdapter({ pool });

    await expect(adapter.get("SELECT * FROM providerConnections")).resolves.toEqual({
      authType: "oauth",
      isActive: 1,
      createdAt: "now",
      connectionId: "conn-1",
    });
  });

  it("uses one checked-out client for every statement in a transaction", async () => {
    const { createPgAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const pool = new FakePool();
    const adapter = createPgAdapter({ pool });

    const result = await adapter.transaction(async () => {
      await adapter.run("INSERT INTO items(id) VALUES(?)", [1]);
      return adapter.get("SELECT * FROM items WHERE id = ?", [1]);
    });

    expect(result).toEqual({ id: "row-1" });
    expect(pool.log.map(({ source, text }) => [source, text])).toEqual([
      ["client", "BEGIN"],
      ["client", "INSERT INTO items(id) VALUES($1)"],
      ["client", "SELECT * FROM items WHERE id = $1"],
      ["client", "COMMIT"],
    ]);
    expect(pool.clients[0].released).toBe(true);
  });

  it("rolls back and removes a broken client from the pool", async () => {
    const { createPgAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const pool = new FakePool();
    const adapter = createPgAdapter({ pool });

    await expect(
      adapter.transaction(async () => adapter.exec("SELECT fail"))
    ).rejects.toThrow("query failed");

    expect(pool.log.map(({ text }) => text)).toEqual(["BEGIN", "SELECT fail", "ROLLBACK"]);
    expect(pool.clients[0].releaseError).toBeInstanceOf(Error);
  });

  it("rejects data-modifying CTEs through read-only worker adapters", async () => {
    const { createPgAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const pool = new FakePool();
    const adapter = createPgAdapter({ pool, readOnly: true });

    await expect(
      adapter.get("WITH deleted AS (DELETE FROM items RETURNING *) SELECT * FROM deleted"),
    ).rejects.toThrow("Cannot write through read-only PostgreSQL adapter");
    expect(pool.log).toHaveLength(0);
  });

  it("closes the pool gracefully", async () => {
    const { createPgAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const pool = new FakePool();
    const adapter = createPgAdapter({ pool });

    await adapter.close();

    expect(pool.ended).toBe(true);
  });

  it("surfaces idle pool errors without logging database credentials", async () => {
    const onPoolError = vi.fn();
    const { createPgAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const pool = new FakePool();
    createPgAdapter({ pool, onPoolError });

    const error = new Error("connection terminated");
    pool.errorHandler(error);

    expect(onPoolError).toHaveBeenCalledWith(error);
  });
});
