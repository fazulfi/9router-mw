import { describe, expect, it, vi } from "vitest";
import { readProviderSummary } from "@/lib/mw/readModel/sqliteReader.js";

const providerRows = [
  {
    provider: "openai",
    connection_count: 2,
    enabled_count: 2,
    last_used_at: "2026-07-20T12:00:00.000Z",
    secret: "must-not-leak",
    access_token: "must-not-leak",
    api_key: "must-not-leak",
    raw_json: "must-not-leak",
  },
];

function makeReadOnlyAdapter() {
  const statement = {
    all: vi.fn(() => providerRows),
  };
  return {
    driver: "better-sqlite3",
    readOnly: true,
    prepare: vi.fn(() => statement),
    exec: vi.fn(),
    run: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(),
    migrate: vi.fn(),
    checkpoint: vi.fn(),
    backup: vi.fn(),
    statement,
  };
}

describe("MW SQLite provider summary reader", () => {
  it("uses one fixed bounded UTC provider-summary query", async () => {
    const adapter = makeReadOnlyAdapter();

    await readProviderSummary(adapter);

    expect(adapter.prepare).toHaveBeenCalledTimes(1);
    const query = adapter.prepare.mock.calls[0][0];
    expect(query).toMatch(/SELECT/i);
    expect(query).toMatch(/provider/i);
    expect(query).toMatch(/ORDER BY/i);
    expect(query).toMatch(/LIMIT\s+50\b/i);
    expect(query).toMatch(/UTC|strftime\s*\(/i);
    expect(adapter.statement.all).toHaveBeenCalledTimes(1);
  });

  it("returns only the allowlisted summary fields and never raw rows", async () => {
    const adapter = makeReadOnlyAdapter();

    const result = await readProviderSummary(adapter);

    expect(result).toEqual([
      {
        provider: "openai",
        connectionCount: 2,
        enabledCount: 2,
        lastUsedAt: "2026-07-20T12:00:00.000Z",
      },
    ]);
    expect(result[0]).not.toHaveProperty("secret");
    expect(result[0]).not.toHaveProperty("access_token");
    expect(result[0]).not.toHaveProperty("api_key");
    expect(result[0]).not.toHaveProperty("raw_json");
  });

  it("uses the read-only adapter surface only: no migrations, writes, sync, checkpoint, or backup", async () => {
    const adapter = makeReadOnlyAdapter();

    await readProviderSummary(adapter);

    expect(adapter.run).not.toHaveBeenCalled();
    expect(adapter.exec).not.toHaveBeenCalled();
    expect(adapter.transaction).not.toHaveBeenCalled();
    expect(adapter.migrate).not.toHaveBeenCalled();
    expect(adapter.checkpoint).not.toHaveBeenCalled();
    expect(adapter.backup).not.toHaveBeenCalled();
    expect(adapter.close).not.toHaveBeenCalled();
  });

  it("rejects an adapter that is not explicitly strict read-only", async () => {
    const adapter = makeReadOnlyAdapter();
    adapter.readOnly = false;

    await expect(readProviderSummary(adapter)).rejects.toThrow(/read.?only/i);
    expect(adapter.prepare).not.toHaveBeenCalled();
  });
});
