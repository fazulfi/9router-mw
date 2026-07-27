import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";

describe("DB write lock guards", () => {
  it("busy_timeout >= 15000 in betterSqliteAdapter source", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/adapters/betterSqliteAdapter.js"),
      "utf-8"
    );
    // Must read DB_BUSY_TIMEOUT from env with fallback >= 15000
    expect(src).toMatch(/DB_BUSY_TIMEOUT/);
    expect(src).toMatch(/\|\|\s*15000/);
  });

  it("busy_timeout >= 15000 in primary-writer source", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../primary-writer.mjs"),
      "utf-8"
    );
    expect(src).toMatch(/DB_BUSY_TIMEOUT/);
    expect(src).toMatch(/\|\|\s*15000/);
  });

  it("requestDetailsRepo has writer mode routing", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/repos/requestDetailsRepo.js"),
      "utf-8"
    );
    expect(src).toMatch(/enqueueDetailEvent/);
    expect(src).toMatch(/MW_WRITER_MODE/);
    expect(src).toMatch(/MW_WORKER_ID/);
  });

  it("usageRepo auto-detects writer mode for cluster workers", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    // Must auto-detect for workers: MW_WORKER_ID triggers writer mode
    expect(src).toMatch(/MW_WORKER_ID/);
    // Must allow explicit override with !== "0"
    expect(src).toMatch(/!== "0"/);
  });

  it("custom-server has boot stagger between worker forks", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../custom-server.js"),
      "utf-8"
    );
    expect(src).toMatch(/Boot stagger/);
    expect(src).toMatch(/2000/);
    expect(src).not.toMatch(/for\s*\(let i\s*=\s*1;\s*i\s*<=\s*workerCount;\s*i\+\+\)/);
  });

  it("detailsBuffer module exists with queue key", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../open-sse/services/detailsBuffer.js"),
      "utf-8"
    );
    expect(src).toMatch(/mw:details:queue/);
    expect(src).toMatch(/enqueueDetailEvent/);
    expect(src).toMatch(/startDetailsFlusher/);
    expect(src).toMatch(/stopDetailsFlusher/);
  });

  it("worker usage routing has no direct SQLite fallback", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    expect(src).toMatch(/throw new Error|writer queue unavailable/);
    expect(src).not.toMatch(/await saveRequestUsageDirect\(entry\)/);
  });

  it("request details routing has no startup direct-write barrier", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/repos/requestDetailsRepo.js"),
      "utf-8"
    );
    expect(src).not.toMatch(/_writerBarrier/);
    expect(src).toMatch(/if \(isWriterMode\(\)\)/);
  });

  it("schema busy timeout is environment-configurable and at least 15000ms", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/schema.js"),
      "utf-8"
    );
    expect(src).toMatch(/DB_BUSY_TIMEOUT/);
    expect(src).not.toMatch(/PRAGMA busy_timeout = 5000/);
  });

  it("usage history has a composite dedup index", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/schema.js"),
      "utf-8"
    );
    expect(src).toMatch(/idx_uh_dedup/);
    expect(src).toMatch(/timestamp, provider, model, connectionId, apiKey/);
  });

  it("uses a validated writer RPC protocol with a dedicated blocking Redis connection", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/writerRpc.js"),
      "utf-8"
    );
    expect(src).toMatch(/WRITE_QUEUE_KEY/);
    expect(src).toMatch(/correlationId/);
    expect(src).toMatch(/duplicate\(\)/);
    expect(src).toMatch(/blpop/);
    expect(src).not.toMatch(/\bsql\b\s*:/);
  });

  it("uses runtime-resolvable relative imports from the dedicated writer DB tree", () => {
    const dbRoot = require("path").resolve(__dirname, "../../src/lib/db");
    const sources = [];
    const visit = (directory) => {
      for (const entry of require("fs").readdirSync(directory, { withFileTypes: true })) {
        const entryPath = require("path").join(directory, entry.name);
        if (entry.isDirectory()) visit(entryPath);
        else if (entry.name.endsWith(".js")) sources.push(require("fs").readFileSync(entryPath, "utf-8"));
      }
    };
    visit(dbRoot);

    const combinedSource = sources.join("\n");
    expect(combinedSource).not.toMatch(/(?:from|import\()["']open-sse\//);
    expect(combinedSource).not.toMatch(/(?:from|import\()["']@\//);
  });

  it("dispatches only allowlisted repository commands in the writer process", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/writerCommands.js"),
      "utf-8"
    );
    expect(src).toMatch(/WRITER_COMMANDS/);
    expect(src).toMatch(/unknown writer command/);
    expect(src).toMatch(/createProviderConnection/);
    expect(src).toMatch(/importDb/);
    expect(src).toMatch(/setAdapterForProcess/);
  });

  it("routes every repository mutation through writer RPC in cluster workers", () => {
    const repoDir = require("path").resolve(__dirname, "../../src/lib/db/repos");
    const sources = require("fs").readdirSync(repoDir)
      .filter((name) => name.endsWith("Repo.js"))
      .map((name) => require("fs").readFileSync(require("path").join(repoDir, name), "utf-8"))
      .join("\n");
    expect(sources).toMatch(/executeWriterCommand/);
    expect(sources).toMatch(/shouldUseWriterRpc/);
    const usageRoute = sources.match(/export async function saveRequestUsageViaRedis[\s\S]*?\n}\n/)?.[0] || "";
    expect(usageRoute).not.toMatch(/saveRequestUsageDirect/);
  });

  it("namespaces writer queues and health by runtime identity", () => {
    const rpc = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/writerRpc.js"),
      "utf-8"
    );
    const writer = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../primary-writer.mjs"),
      "utf-8"
    );
    expect(rpc).toMatch(/MW_RUNTIME_NAMESPACE/);
    expect(writer).toMatch(/getWriterRuntimeNamespace/);
    expect(writer).toMatch(/WRITER_HEALTH_KEY/);
    expect(writer).not.toMatch(/redis\.set\("mw:writer:health"/);
    const healthRoute = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/app/api/health/route.js"),
      "utf-8"
    );
    expect(healthRoute).toMatch(/MW_RUNTIME_NAMESPACE/);
    expect(healthRoute).not.toContain('r.get("mw:writer:health")');
  });

  it("opens native SQLite adapters read-only inside cluster workers", () => {
    const better = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/adapters/betterSqliteAdapter.js"),
      "utf-8"
    );
    const node = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/adapters/nodeSqliteAdapter.js"),
      "utf-8"
    );
    expect(better).toMatch(/createBetterSqliteAdapter\(filePath,\s*\{\s*readOnly\s*=\s*false\s*\}/);
    expect(better).toMatch(/readonly:\s*readOnly/);
    expect(better).toMatch(/fileMustExist:\s*readOnly/);
    expect(node).toMatch(/createNodeSqliteAdapter\(filePath,\s*\{\s*readOnly\s*=\s*false\s*\}/);
    expect(node).toMatch(/readOnly/);
  });

  it("does not migrate or checkpoint SQLite from cluster workers", () => {
    const driver = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/driver.js"),
      "utf-8"
    );
    const better = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/adapters/betterSqliteAdapter.js"),
      "utf-8"
    );
    const node = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/lib/db/adapters/nodeSqliteAdapter.js"),
      "utf-8"
    );
    expect(driver).toMatch(/const readOnly = isClusterWorker\(\)/);
    expect(driver).toMatch(/if \(!readOnly\)[\s\S]*runMigrationOnce/);
    expect(better).toMatch(/if \(!readOnly\)[\s\S]*CHECKPOINT_INTERVAL_MS/);
    expect(node).toMatch(/if \(!readOnly\)[\s\S]*CHECKPOINT_INTERVAL_MS/);
  });

  it("rejects write APIs on read-only worker adapters", () => {
    for (const name of ["betterSqliteAdapter.js", "nodeSqliteAdapter.js"]) {
      const src = require("fs").readFileSync(
        require("path").resolve(__dirname, `../../src/lib/db/adapters/${name}`),
        "utf-8"
      );
      expect(src).toMatch(/assertWritable/);
      expect(src).toMatch(/read-only SQLite adapter/);
      expect(src).toMatch(/run\(sql, params = \[\]\)[\s\S]*assertWritable\(\)/);
      expect(src).toMatch(/transaction\(fn\)[\s\S]*assertWritable\(\)/);
    }
  });

  it("runs migrations only from the dedicated writer before queue processing", () => {
    const writer = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../primary-writer.mjs"),
      "utf-8"
    );
    expect(writer).toMatch(/runMigrationOnce/);
    expect(writer).toMatch(/await runMigrationOnce\(writerAdapter\)/);
    expect(writer.indexOf("await runMigrationOnce(writerAdapter)")).toBeLessThan(
      writer.indexOf("startUsageFlusher(")
    );
  });

  it("waits for writer migration readiness before forking read-only workers", () => {
    const server = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../custom-server.js"),
      "utf-8"
    );
    const readyHandler = server.match(/if \(msg\?\.type === "writer:ready"\) \{[\s\S]*?\n\s*\}/)?.[0] || "";
    expect(readyHandler).toMatch(/if \(!workersStarted\)/);
    expect(readyHandler).toMatch(/workersStarted = true/);
    expect(readyHandler).toMatch(/forkWorkersWithStagger\(1\)/);
    expect(server.match(/forkWorkersWithStagger\(1\)/g)).toHaveLength(1);
  });

  it("allows reads but rejects writes through a better-sqlite3 worker adapter", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-readonly-"));
    const dbPath = path.join(tempDir, "data.sqlite");
    const writer = createBetterSqliteAdapter(dbPath);
    writer.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    writer.run("INSERT INTO probe(value) VALUES(?)", ["ready"]);
    writer.close();

    const reader = createBetterSqliteAdapter(dbPath, { readOnly: true });
    expect(reader.get("SELECT value FROM probe WHERE id = 1")).toEqual({ value: "ready" });
    expect(() => reader.run("INSERT INTO probe(value) VALUES(?)", ["blocked"])).toThrow(
      "read-only SQLite adapter"
    );
    expect(() => reader.transaction(() => {})).toThrow("read-only SQLite adapter");
    reader.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
