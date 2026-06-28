import { spawn } from "child_process";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import crypto from "node:crypto";
import path from "node:path";

const BASE = "http://localhost:3003";
const SERVER_SCRIPT = ".next/standalone/server.js";
const STARTUP_TIMEOUT_MS = 60000;

function generateTestApiKey() {
  return `sk-test-${crypto.randomUUID().replace(/-/g, "")}`;
}

export const TEST_API_KEY = process.env.TEST_API_KEY || generateTestApiKey();

let serverProcess = null;

async function isServerReady() {
  try {
    const res = await proxyAwareFetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureTestServer() {
  if (await isServerReady()) return;

  const env = {
    ...process.env,
    PORT: "3003",
    JWT_SECRET: process.env.JWT_SECRET || "test-jwt-secret-for-ci-only",
    INITIAL_PASSWORD: process.env.INITIAL_PASSWORD || "123456",
    DATA_DIR: process.env.DATA_DIR || "/home/vanszs/.9route",
    NODE_ENV: "production",
    ENABLE_REQUEST_LOGS: "false",
    OBSERVABILITY_ENABLED: "false",
    REQUIRE_API_KEY: "true",
  };

  serverProcess = spawn("node", [SERVER_SCRIPT], {
    env,
    stdio: "ignore",
    detached: true,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (await isServerReady()) {
      await seedTestApiKey(env.DATA_DIR);
      return;
    }
    await wait(500);
  }

  throw new Error(`Test server did not start within ${STARTUP_TIMEOUT_MS}ms`);
}

async function seedTestApiKey(dataDir) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "db/data.sqlite"));
    db.prepare(
      "INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedProviders, allowedCombos, allowedKinds) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("test-key-1", TEST_API_KEY, "CI Test Key", "ci", 1, new Date().toISOString(), null, null, null);
    db.close();
  } catch (err) {
    console.warn("[test-server] failed to seed API key:", err.message);
  }
}

export async function stopTestServer() {
  if (!serverProcess) return;
  try {
    process.kill(-serverProcess.pid, "SIGTERM");
  } catch {
    // ignore
  }
  serverProcess = null;
}
