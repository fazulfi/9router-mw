import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { encryptSecretJson, decryptSecretJson } from "../helpers/secretCol.js";
import crypto from "node:crypto";
import { generateApiKeyWithMachine } from "@/shared/utils/apiKey.js";

// ─── Helpers ────────────────────────────────────────────────────────

const DEFAULT_SCOPE = JSON.stringify({
  models: ["*"],
  providers: ["*"],
  maxDailySpend: null,
  maxRatePerMin: null,
});

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    keyPrefix: row.keyPrefix,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    scope: row.scope ? safeParseScope(row.scope) : JSON.parse(DEFAULT_SCOPE),
    keyVersion: row.keyVersion ?? 1,
    rotationPolicy: row.rotationPolicy || "none",
    rotationDays: row.rotationDays ?? null,
    expiresAt: row.expiresAt ?? null,
    rotatedFromId: row.rotatedFromId ?? null,
    createdAt: row.createdAt,
  };
}

function safeParseScope(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(DEFAULT_SCOPE);
  }
}

export function logAudit(db, { apiKeyId, apiKeyHash, event, metadata = {} }) {
  db.run(
    `INSERT INTO apiKeyAudit(apiKeyId, apiKeyHash, event, metadata) VALUES(?, ?, ?, ?)`,
    [apiKeyId, apiKeyHash || null, event, JSON.stringify(metadata)]
  );
}

// ─── Public API ─────────────────────────────────────────────────────

export async function createApiKey(name, machineId, scope) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const result = generateApiKeyWithMachine(machineId);
  const keyHash = crypto.createHash("sha256").update(result.key).digest("hex");
  const keyPrefix = result.key.slice(0, 12);
  const encrypted = encryptSecretJson({ k: result.key });
  const id = uuidv4();
  const scopeJson = scope ? JSON.stringify(scope) : DEFAULT_SCOPE;

  db.run(
    `INSERT INTO apiKeys(id, key, keyHash, keyPrefix, name, machineId, isActive, scope, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, encrypted, keyHash, keyPrefix, name || null, machineId, 1, scopeJson, new Date().toISOString()]
  );

  logAudit(db, { apiKeyId: id, apiKeyHash: keyHash, event: "created", metadata: { name: name || null } });

  return { id, ...result, key: result.key, machineId, isActive: true };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  let keyHash = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    keyHash = row.keyHash;

    const updates = [];
    const params = [];

    if (data.isActive !== undefined) {
      updates.push("isActive = ?");
      params.push(data.isActive ? 1 : 0);
    }
    if (data.scope !== undefined) {
      updates.push("scope = ?");
      params.push(typeof data.scope === "string" ? data.scope : JSON.stringify(data.scope));
    }
    if (data.name !== undefined) {
      updates.push("name = ?");
      params.push(data.name);
    }
    if (data.rotationPolicy !== undefined) {
      updates.push("rotationPolicy = ?");
      params.push(data.rotationPolicy);
    }
    if (data.rotationDays !== undefined) {
      updates.push("rotationDays = ?");
      params.push(data.rotationDays);
    }
    if (data.expiresAt !== undefined) {
      updates.push("expiresAt = ?");
      params.push(data.expiresAt);
    }

    if (updates.length > 0) {
      params.push(id);
      db.run(`UPDATE apiKeys SET ${updates.join(", ")} WHERE id = ?`, params);
    }

    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });

  if (result && keyHash) {
    const eventType = data.isActive !== undefined
      ? (data.isActive ? "activated" : "deactivated")
      : (data.scope !== undefined ? "scope_changed" : "updated");
    logAudit(db, {
      apiKeyId: id,
      apiKeyHash: keyHash,
      event: eventType,
      metadata: { changes: Object.keys(data).join(",") },
    });
  }

  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT keyHash FROM apiKeys WHERE id = ?`, [id]);
  if (!row) return false;
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  logAudit(db, { apiKeyId: id, apiKeyHash: row.keyHash, event: "deleted" });
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(rawKey) {
  if (!rawKey) return false;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE keyHash = ?`, [keyHash]);
  if (!row) return false;
  if (!(row.isActive === 1 || row.isActive === true)) return false;
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return false;
  return true;
}

export async function validateKeyScope(rawKey, { model, provider } = {}) {
  if (!rawKey) return { valid: false, reason: "missing key" };
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, scope, expiresAt, keyHash AS kh FROM apiKeys WHERE keyHash = ?`, [keyHash]);
  if (!row) return { valid: false, reason: "not found" };
  if (!(row.isActive === 1 || row.isActive === true)) return { valid: false, reason: "inactive" };
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return { valid: false, reason: "expired" };

  const scope = safeParseScope(row.scope);

  if (model && scope.models && scope.models[0] !== "*" && !scope.models.includes(model)) {
    return { valid: false, reason: "model not allowed" };
  }
  if (provider && scope.providers && scope.providers[0] !== "*" && !scope.providers.includes(provider)) {
    return { valid: false, reason: "provider not allowed" };
  }

  return { valid: true };
}

export async function revealApiKey(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  if (!row) return null;

  const decrypted = decryptSecretJson(row.key);
  if (!decrypted || !decrypted.k) return null;

  logAudit(db, { apiKeyId: id, apiKeyHash: row.keyHash, event: "revealed" });

  return {
    ...rowToKey(row),
    key: decrypted.k,
  };
}

export async function rotateApiKey(id, { policy, days } = {}) {
  const db = await getAdapter();
  const existing = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  if (!existing) throw new Error(`API key ${id} not found`);

  const result = generateApiKeyWithMachine(existing.machineId);
  const newKeyHash = crypto.createHash("sha256").update(result.key).digest("hex");
  const keyPrefix = result.key.slice(0, 12);
  const encrypted = encryptSecretJson({ k: result.key });
  const newId = uuidv4();
  const now = new Date().toISOString();

  db.transaction(() => {
    if (policy === "immediate") {
      db.run(`UPDATE apiKeys SET isActive = 0 WHERE id = ?`, [id]);
    } else if (policy === "grace") {
      const expiresAt = new Date(Date.now() + (days || 7) * 86400000).toISOString();
      db.run(
        `UPDATE apiKeys SET expiresAt = ?, rotationPolicy = 'grace', rotationDays = ? WHERE id = ?`,
        [expiresAt, days || 7, id]
      );
    }

    db.run(
      `INSERT INTO apiKeys(id, key, keyHash, keyPrefix, name, machineId, isActive, scope, keyVersion, rotationPolicy, rotatedFromId, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId, encrypted, newKeyHash, keyPrefix,
        existing.name, existing.machineId, 1,
        existing.scope || DEFAULT_SCOPE, (existing.keyVersion || 1) + 1,
        policy || "none", id, now,
      ]
    );
  });

  logAudit(db, {
    apiKeyId: id,
    apiKeyHash: existing.keyHash,
    event: "rotated",
    metadata: { policy, newKeyHash },
  });

  return { ...result, key: result.key, id: newId };
}
