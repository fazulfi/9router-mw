// ─── T2 Security & Virtual Keys — Unit Tests ──────────────────────────
// Covers: apiKeysRepo.js, apiKey.js, auth.js (isValidApiKey), secretCol.js (deriveKey)
// Uses better-sqlite3 in-memory database with mocked driver.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import crypto from "node:crypto";

// ─── Hoisted shared state for driver mock ─────────────────────────────
const mockDbRef = vi.hoisted(() => ({ current: null }));

// Mock driver BEFORE any imports — vitest hoists these to the top
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => {
    if (!mockDbRef.current) throw new Error("DB not initialized — call setupDb() in beforeAll");
    return mockDbRef.current;
  },
  getAdapterSync: () => {
    if (!mockDbRef.current) throw new Error("DB not initialized — call setupDb() in beforeAll");
    return mockDbRef.current;
  },
}));

// Mock node-machine-id is NOT done via vi.mock because vi.mock does not intercept
// CJS require() calls from ESM modules. The deriveKey throw test uses a direct
// require.cache patch instead (see deriveKey describe block).

// ─── Imports (after mocks ────────────────────────────────────────────
import { hashApiKey, generateApiKeyWithMachine, parseApiKey } from "../../src/shared/utils/apiKey.js";
import { encryptSecretJson, decryptSecretJson } from "../../src/lib/db/helpers/secretCol.js";
import {
  createApiKey, getApiKeys, getApiKeyById, validateApiKey, validateKeyScope,
  revealApiKey, rotateApiKey, deleteApiKey, logAudit, updateApiKey,
} from "../../src/lib/db/repos/apiKeysRepo.js";
import { isValidApiKey } from "../../src/sse/services/auth.js";

// ─── Schema DDL ──────────────────────────────────────────────────────
const CREATE_API_KEYS = `
  CREATE TABLE IF NOT EXISTS apiKeys (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    keyHash TEXT UNIQUE NOT NULL,
    keyPrefix TEXT NOT NULL,
    name TEXT,
    machineId TEXT,
    isActive INTEGER DEFAULT 1,
    scope TEXT NOT NULL DEFAULT '{"models":["*"],"providers":["*"],"maxDailySpend":null,"maxRatePerMin":null}',
    keyVersion INTEGER DEFAULT 1,
    rotationPolicy TEXT DEFAULT 'none',
    rotationDays INTEGER,
    expiresAt TEXT,
    rotatedFromId TEXT REFERENCES apiKeys(id),
    createdAt TEXT NOT NULL
  )
`;

const CREATE_API_KEY_AUDIT = `
  CREATE TABLE IF NOT EXISTS apiKeyAudit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apiKeyId TEXT NOT NULL,
    apiKeyHash TEXT,
    event TEXT NOT NULL,
    metadata TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const AUDIT_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_aka_keyid ON apiKeyAudit(apiKeyId, timestamp DESC)",
  "CREATE INDEX IF NOT EXISTS idx_aka_event ON apiKeyAudit(event, timestamp DESC)",
  "CREATE INDEX IF NOT EXISTS idx_aka_hash ON apiKeyAudit(apiKeyHash, timestamp DESC)",
];

// ─── Adapter factory ─────────────────────────────────────────────────
function createMockAdapter(sqliteDb) {
  return {
    driver: "better-sqlite3",
    run(sql, params = []) { return sqliteDb.prepare(sql).run(...params); },
    get(sql, params = []) { return sqliteDb.prepare(sql).get(...params); },
    all(sql, params = []) { return sqliteDb.prepare(sql).all(...params); },
    exec(sql) { return sqliteDb.exec(sql); },
    transaction(fn) { return sqliteDb.transaction(fn)(); },
    close() { sqliteDb.close(); },
    raw: sqliteDb,
  };
}

// ─── Helper: create key in DB and return it ──────────────────────────
async function createTestKey(name, machineId, scope) {
  return createApiKey(name || "test-key", machineId || "test-machine-001", scope);
}

// ─── Suite ───────────────────────────────────────────────────────────
describe("T2 Security & Virtual Keys", () => {
  let db;
  let adapter;
  const ORIGINAL_DB_KEY = process.env.DB_ENCRYPTION_KEY;

  beforeAll(() => {
    // Set encryption key so deriveKey uses env var (machine-id mock is never reached)
    process.env.DB_ENCRYPTION_KEY = "test-key-32-bytes-for-aes-256-gcm!!";

    db = new Database(":memory:");
    adapter = createMockAdapter(db);
    mockDbRef.current = adapter;

    // Apply DDL
    db.exec(CREATE_API_KEYS);
    db.exec(CREATE_API_KEY_AUDIT);
    for (const idx of AUDIT_INDEXES) {
      db.exec(idx);
    }
  });

  afterAll(() => {
    if (db) db.close();
    if (ORIGINAL_DB_KEY === undefined) delete process.env.DB_ENCRYPTION_KEY;
    else process.env.DB_ENCRYPTION_KEY = ORIGINAL_DB_KEY;
  });

  // Isolate each test
  beforeEach(() => {
    db.exec("DELETE FROM apiKeyAudit");
    db.exec("DELETE FROM apiKeys");
  });

  // ══════════════════════════════════════════════════════════════════
  //  hashApiKey (apiKey.js)
  // ══════════════════════════════════════════════════════════════════
  describe("hashApiKey (shared/utils/apiKey.js)", () => {
    it("returns a SHA-256 hex string of length 64", () => {
      const key = "sk-machinea-keyid-abc12345";
      const result = hashApiKey(key);
      expect(result).toBe(crypto.createHash("sha256").update(key).digest("hex"));
      expect(result).toHaveLength(64);
    });

    it("is deterministic for the same input", () => {
      const key = "sk-aaaaaaaaaaaa-0000000000";
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it("produces different outputs for different inputs", () => {
      const a = hashApiKey("sk-one-keyid-abcdef12");
      const b = hashApiKey("sk-two-keyid-34567890");
      expect(a).not.toBe(b);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  deriveKey (secretCol.js) — throw behavior
  // ══════════════════════════════════════════════════════════════════
  describe("deriveKey (helpers/secretCol.js)", () => {
    it("throws when DB_ENCRYPTION_KEY is unset and machine-id is unavailable", () => {
      const savedKey = process.env.DB_ENCRYPTION_KEY;
      delete process.env.DB_ENCRYPTION_KEY;

      // Pre-load node-machine-id so it lands in require.cache, then patch
      // exports so machineIdSync throws.
      const nmidPath = require.resolve("node-machine-id");
      require(nmidPath); // ensure cached
      const origExports = require.cache[nmidPath].exports;
      require.cache[nmidPath].exports = {
        machineIdSync: () => { throw new Error("simulated machine-id failure"); },
        machineId: () => Promise.reject(new Error("simulated failure")),
      };

      try {
        expect(() => encryptSecretJson({ test: true })).toThrow(/DB_ENCRYPTION_KEY/);
      } finally {
        require.cache[nmidPath].exports = origExports;
        process.env.DB_ENCRYPTION_KEY = savedKey;
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  apiKeysRepo
  // ══════════════════════════════════════════════════════════════════
  describe("apiKeysRepo (lib/db/repos/apiKeysRepo.js)", () => {
    // ── createApiKey ──────────────────────────────────────────────
    describe("createApiKey", () => {
      it("encrypts the key via encryptSecretJson, stores keyHash + keyPrefix", async () => {
        const result = await createTestKey("my-creds", "machine-xyz");

        // Returned object has the plaintext key
        expect(result.key).toMatch(/^sk-/);
        expect(result.id).toBeDefined();
        expect(result.machineId).toBe("machine-xyz");

        // DB row: key should be encrypted (not plaintext)
        const row = db.prepare("SELECT * FROM apiKeys WHERE id = ?").get(result.id);
        expect(row).toBeDefined();
        expect(row.key).toMatch(/^enc1:/);               // encrypted prefix
        expect(row.key).not.toContain(result.key);       // plaintext not visible
        expect(row.keyHash).toBe(crypto.createHash("sha256").update(result.key).digest("hex"));
        expect(row.keyPrefix).toBe(result.key.slice(0, 12));
        expect(row.isActive).toBe(1);

        // Verify decryption round-trips
        const decrypted = decryptSecretJson(row.key);
        expect(decrypted).toEqual({ k: result.key });
      });

      it("requires machineId", async () => {
        await expect(createApiKey("no-mid")).rejects.toThrow("machineId is required");
      });

      it("creates an audit log entry with event 'created'", async () => {
        const result = await createTestKey("audit-test", "machine-audit");
        const audits = db.prepare("SELECT * FROM apiKeyAudit WHERE apiKeyId = ?").all(result.id);
        expect(audits).toHaveLength(1);
        expect(audits[0].event).toBe("created");
      });
    });

    // ── validateApiKey ────────────────────────────────────────────
    describe("validateApiKey", () => {
      it("returns true for an active key (lookup by SHA-256 hash)", async () => {
        const { key } = await createTestKey("active-test", "machine-val");
        expect(await validateApiKey(key)).toBe(true);
      });

      it("returns false for an inactive key", async () => {
        const { id, key } = await createTestKey("inactive-test", "machine-val");
        await updateApiKey(id, { isActive: false });
        expect(await validateApiKey(key)).toBe(false);
      });

      it("returns false for a non-existent key", async () => {
        expect(await validateApiKey("sk-fake-000000-00000000")).toBe(false);
      });

      it("returns false for empty / null input", async () => {
        expect(await validateApiKey("")).toBe(false);
        expect(await validateApiKey(null)).toBe(false);
        expect(await validateApiKey(undefined)).toBe(false);
      });

      it("returns false for an expired key", async () => {
        const { id, key } = await createTestKey("expired-val", "machine-val");
        await updateApiKey(id, { expiresAt: new Date(Date.now() - 86400000).toISOString() });
        expect(await validateApiKey(key)).toBe(false);
      });
    });

    // ── validateKeyScope ──────────────────────────────────────────
    describe("validateKeyScope", () => {
      it('allows any model when scope models contains "*"', async () => {
        const { key } = await createTestKey("wild-model", "m1", { models: ["*"], providers: ["*"] });
        const result = await validateKeyScope(key, { model: "gpt-4o" });
        expect(result).toEqual({ valid: true });
      });

      it("rejects a model not in scope.models", async () => {
        const { key } = await createTestKey("restrict-model", "m1", { models: ["gpt-4o"], providers: ["*"] });
        const result = await validateKeyScope(key, { model: "claude-sonnet" });
        expect(result).toEqual({ valid: false, reason: "model not allowed" });
      });

      it('allows any provider when scope providers contains "*"', async () => {
        const { key } = await createTestKey("wild-provider", "m2", { models: ["*"], providers: ["*"] });
        const result = await validateKeyScope(key, { provider: "openai" });
        expect(result).toEqual({ valid: true });
      });

      it("rejects a provider not in scope.providers", async () => {
        const { key } = await createTestKey("restrict-provider", "m3", { models: ["*"], providers: ["openai"] });
        const result = await validateKeyScope(key, { model: "gpt-4o", provider: "anthropic" });
        expect(result).toEqual({ valid: false, reason: "provider not allowed" });
      });

      it("returns {valid:false, reason:'expired'} for an expired key", async () => {
        const { id, key } = await createTestKey("expired-scope", "m4", { models: ["*"], providers: ["*"] });
        await updateApiKey(id, { expiresAt: new Date(Date.now() - 86400000).toISOString() });
        const result = await validateKeyScope(key, { model: "gpt-4o" });
        expect(result).toEqual({ valid: false, reason: "expired" });
      });

      it("returns {valid:false, reason:'not found'} for unknown key", async () => {
        const result = await validateKeyScope("sk-none-00000000-00000000", { model: "gpt-4o" });
        expect(result).toEqual({ valid: false, reason: "not found" });
      });

      it("returns {valid:false, reason:'inactive'} for deactivated key", async () => {
        const { id, key } = await createTestKey("deact-scope", "m5");
        await updateApiKey(id, { isActive: false });
        const result = await validateKeyScope(key, { model: "gpt-4o" });
        expect(result).toEqual({ valid: false, reason: "inactive" });
      });

      it("returns {valid:false, reason:'missing key'} for null/empty input", async () => {
        expect(await validateKeyScope(null)).toEqual({ valid: false, reason: "missing key" });
        expect(await validateKeyScope("")).toEqual({ valid: false, reason: "missing key" });
      });

      it("checks model before provider in rejection order", async () => {
        // When both model and provider are restricted, model is checked first
        const { key } = await createTestKey("order-check", "m6", { models: ["gpt-4o"], providers: ["openai"] });
        const result = await validateKeyScope(key, { model: "claude-sonnet", provider: "anthropic" });
        expect(result.reason).toBe("model not allowed");
      });
    });

    // ── revealApiKey ──────────────────────────────────────────────
    describe("revealApiKey", () => {
      it("decrypts and returns the plaintext key", async () => {
        const created = await createTestKey("reveal-me", "machine-reveal");
        const revealed = await revealApiKey(created.id);
        expect(revealed).not.toBeNull();
        expect(revealed.key).toBe(created.key);
        expect(revealed.id).toBe(created.id);
      });

      it("returns null for a non-existent id", async () => {
        expect(await revealApiKey("no-such-id")).toBeNull();
      });

      it("logs an audit event 'revealed'", async () => {
        const created = await createTestKey("reveal-audit", "machine-rev");
        await revealApiKey(created.id);

        const audits = db.prepare("SELECT * FROM apiKeyAudit WHERE apiKeyId = ? AND event = 'revealed'").all(created.id);
        expect(audits).toHaveLength(1);
      });
    });

    // ── rotateApiKey ──────────────────────────────────────────────
    describe("rotateApiKey", () => {
      it("immediate mode deactivates the old key", async () => {
        const created = await createTestKey("rotate-immediate", "machine-rot");
        const rotated = await rotateApiKey(created.id, { policy: "immediate" });

        expect(rotated).toBeDefined();
        expect(rotated.key).toMatch(/^sk-/);
        expect(rotated.id).not.toBe(created.id);

        // Old key deactivated
        const oldRow = db.prepare("SELECT isActive FROM apiKeys WHERE id = ?").get(created.id);
        expect(oldRow.isActive).toBe(0);

        // New key is active
        const newRow = db.prepare("SELECT isActive FROM apiKeys WHERE id = ?").get(rotated.id);
        expect(newRow.isActive).toBe(1);
      });

      it("grace mode sets expiresAt on the old key", async () => {
        const created = await createTestKey("rotate-grace", "machine-gr");
        const rotated = await rotateApiKey(created.id, { policy: "grace", days: 14 });

        expect(rotated).toBeDefined();
        expect(rotated.id).not.toBe(created.id);

        // Old key still active but has future expiry
        const oldRow = db.prepare("SELECT isActive, expiresAt FROM apiKeys WHERE id = ?").get(created.id);
        expect(oldRow.isActive).toBe(1);
        expect(oldRow.expiresAt).not.toBeNull();
        expect(new Date(oldRow.expiresAt).getTime()).toBeGreaterThan(Date.now());
      });

      it("grace mode defaults to 7 days when days not specified", async () => {
        const created = await createTestKey("rotate-grace-default", "machine-gd");
        const rotated = await rotateApiKey(created.id, { policy: "grace" });

        const oldRow = db.prepare("SELECT expiresAt, rotationDays FROM apiKeys WHERE id = ?").get(created.id);
        expect(oldRow.rotationDays).toBe(7);
        // ~7 days from now (allow 10s tolerance)
        const expected = Date.now() + 7 * 86400000;
        const actual = new Date(oldRow.expiresAt).getTime();
        expect(Math.abs(actual - expected)).toBeLessThan(5000);
      });

      it("new key inherits scope and increments keyVersion", async () => {
        const created = await createTestKey("rotate-version", "machine-v", { models: ["gpt-4o"], providers: ["openai"] });
        const rotated = await rotateApiKey(created.id, { policy: "immediate" });

        const newRow = db.prepare("SELECT scope, keyVersion, rotatedFromId FROM apiKeys WHERE id = ?").get(rotated.id);
        expect(JSON.parse(newRow.scope)).toEqual({ models: ["gpt-4o"], providers: ["openai"] });
        expect(newRow.keyVersion).toBe(2);
        expect(newRow.rotatedFromId).toBe(created.id);
      });

      it("throws when key id does not exist", async () => {
        await expect(rotateApiKey("no-such-id", { policy: "immediate" })).rejects.toThrow("not found");
      });

      it("logs an audit event 'rotated'", async () => {
        const created = await createTestKey("rotate-audit", "machine-ra");
        await rotateApiKey(created.id, { policy: "immediate" });

        const audits = db.prepare("SELECT * FROM apiKeyAudit WHERE apiKeyId = ? AND event = 'rotated'").all(created.id);
        expect(audits).toHaveLength(1);
      });
    });

    // ── deleteApiKey ──────────────────────────────────────────────
    describe("deleteApiKey", () => {
      it("removes the key and returns true", async () => {
        const { id, key } = await createTestKey("delete-me", "machine-del");
        const deleted = await deleteApiKey(id);
        expect(deleted).toBe(true);
        expect(db.prepare("SELECT * FROM apiKeys WHERE id = ?").get(id)).toBeUndefined();
      });

      it("returns false for a non-existent id", async () => {
        expect(await deleteApiKey("no-such-id")).toBe(false);
      });

      it("logs an audit event 'deleted'", async () => {
        const { id } = await createTestKey("delete-audit", "machine-da");
        await deleteApiKey(id);

        const audits = db.prepare("SELECT * FROM apiKeyAudit WHERE apiKeyId = ? AND event = 'deleted'").all(id);
        expect(audits).toHaveLength(1);
      });
    });

    // ── logAudit ───────────────────────────────────────────────────
    describe("logAudit", () => {
      it("creates an entry in the apiKeyAudit table", async () => {
        const { id, key } = await createTestKey("audit-test", "machine-al");
        const keyHash = crypto.createHash("sha256").update(key).digest("hex");
        const db2 = mockDbRef.current;

        logAudit(db2, {
          apiKeyId: id,
          apiKeyHash: keyHash,
          event: "custom-event",
          metadata: { reason: "unit-test" },
        });

        const row = db.prepare("SELECT * FROM apiKeyAudit WHERE apiKeyId = ? AND event = 'custom-event'").get(id);
        expect(row).toBeDefined();
        expect(row.apiKeyHash).toBe(keyHash);
        expect(JSON.parse(row.metadata)).toEqual({ reason: "unit-test" });
      });
    });

    // ── getApiKeys / getApiKeyById ────────────────────────────────
    describe("list / get by id", () => {
      it("getApiKeys returns all keys ordered by createdAt", async () => {
        const k1 = await createTestKey("first", "m1");
        const k2 = await createTestKey("second", "m2");

        const list = await getApiKeys();
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe("first");
        expect(list[1].name).toBe("second");
      });

      it("getApiKeyById returns a single key or null", async () => {
        const { id } = await createTestKey("by-id", "m3");
        const found = await getApiKeyById(id);
        expect(found).not.toBeNull();
        expect(found.name).toBe("by-id");

        expect(await getApiKeyById("no-such-id")).toBeNull();
      });
    });

    // ── updateApiKey ───────────────────────────────────────────────
    describe("updateApiKey", () => {
      it("updates isActive, scope, name, rotationPolicy, expiresAt", async () => {
        const { id } = await createTestKey("update-me", "m-upd");
        const updated = await updateApiKey(id, {
          isActive: false,
          name: "renamed",
          scope: { models: ["gpt-4"], providers: ["openai"] },
          rotationPolicy: "scheduled",
          rotationDays: 30,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
        expect(updated.isActive).toBe(false);
        expect(updated.name).toBe("renamed");
        expect(updated.scope.models).toEqual(["gpt-4"]);
        expect(updated.rotationPolicy).toBe("scheduled");
        expect(updated.rotationDays).toBe(30);
        expect(updated.expiresAt).not.toBeNull();
      });

      it("logs audit event for activation/deactivation", async () => {
        const { id } = await createTestKey("audit-upd", "m-au");
        await updateApiKey(id, { isActive: false });

        const audits = db.prepare("SELECT * FROM apiKeyAudit WHERE apiKeyId = ? AND event = 'deactivated'").all(id);
        expect(audits).toHaveLength(1);
      });

      it("logs audit event for scope changes", async () => {
        const { id } = await createTestKey("audit-scope", "m-as");
        await updateApiKey(id, { scope: { models: ["gpt-4"] } });

        const audits = db.prepare("SELECT * FROM apiKeyAudit WHERE apiKeyId = ? AND event = 'scope_changed'").all(id);
        expect(audits).toHaveLength(1);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  auth.js — isValidApiKey integration
  // ══════════════════════════════════════════════════════════════════
  describe("isValidApiKey (sse/services/auth.js)", () => {
    it("passes model/provider to validateKeyScope and returns valid boolean", async () => {
      // Key with wide-open scope should allow any model/provider
      const { key } = await createTestKey("auth-test", "machine-auth", {
        models: ["*"], providers: ["*"],
      });
      const valid = await isValidApiKey(key, { model: "gpt-4o", provider: "openai" });
      expect(valid).toBe(true);
    });

    it("rejects a key when model is outside scope", async () => {
      const { key } = await createTestKey("auth-restrict", "machine-ar", {
        models: ["gpt-4o"], providers: ["*"],
      });
      const valid = await isValidApiKey(key, { model: "claude-sonnet", provider: "anthropic" });
      expect(valid).toBe(false);
    });

    it("rejects a key when provider is outside scope", async () => {
      const { key } = await createTestKey("auth-provider", "machine-ap", {
        models: ["*"], providers: ["openai"],
      });
      const valid = await isValidApiKey(key, { model: "gpt-4o", provider: "anthropic" });
      expect(valid).toBe(false);
    });

    it("returns false for a missing key", async () => {
      expect(await isValidApiKey("")).toBe(false);
      expect(await isValidApiKey(null)).toBe(false);
      expect(await isValidApiKey(undefined)).toBe(false);
    });

    it("handles audit logging gracefully (audit errors do not block the request)", async () => {
      // isValidApiKey calls logAudit inside a try/catch — the audit entry is
      // best-effort and silently dropped if it fails (e.g. missing apiKeyId
      // violates the NOT NULL constraint on apiKeyAudit.apiKeyId).
      // The validation itself must still succeed.
      const { key } = await createTestKey("auth-audit", "machine-aa", {
        models: ["*"], providers: ["*"],
      });
      const valid = await isValidApiKey(key, { model: "gpt-4o", provider: "openai" });
      expect(valid).toBe(true);
      // The audit INSERT may have failed silently — that is acceptable behavior
    });

    it("returns false and does not throw for rejected keys", async () => {
      const key = "sk-none-000000-00000000";

      // Key doesn't exist in DB — should return false without throwing
      await expect(isValidApiKey(key, { model: "gpt-4o", provider: "openai" })).resolves.toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Combined scenario: rotate + validate old + validate new
  // ══════════════════════════════════════════════════════════════════
  describe("rotation lifecycle", () => {
    it("immediate rotation: old key invalid, new key valid", async () => {
      const created = await createTestKey("lifecycle", "machine-lc");
      const rotated = await rotateApiKey(created.id, { policy: "immediate" });

      // Old key should not validate
      expect(await validateApiKey(created.key)).toBe(false);
      // New key should validate
      expect(await validateApiKey(rotated.key)).toBe(true);
    });

    it("grace rotation: old key still valid until expiry", async () => {
      const created = await createTestKey("grace-lifecycle", "machine-gl");
      const rotated = await rotateApiKey(created.id, { policy: "grace", days: 7 });

      // Old key temporarily still valid (not past expiration)
      expect(await validateApiKey(created.key)).toBe(true);
      // New key also valid
      expect(await validateApiKey(rotated.key)).toBe(true);
    });
  });
});
