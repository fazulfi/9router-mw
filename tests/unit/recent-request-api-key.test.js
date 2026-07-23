import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-recent-api-key-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  global._dbAdapter?.instance?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("recent request API key attribution", () => {
  it("resolves the API key name from usage history", async () => {
    const apiKey = await db.createApiKey("Production SDK", "test-machine");
    await db.saveRequestUsage({
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      apiKey: apiKey.key,
      tokens: { prompt_tokens: 120, completion_tokens: 30 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const stats = await db.getUsageStats("24h");

    expect(stats.recentRequests[0].apiKeyName).toBe("Production SDK");
  });
});
