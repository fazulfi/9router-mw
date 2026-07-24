const cluster = require("cluster");
const http = require("http");
const path = require("path");
const { fork } = require("child_process");

/**
 * 9router-mw multi-worker entry (Fase 3).
 * Primary forks N workers (always 4 in production); each worker runs Next standalone
 * via require("./server.js"). Cluster distributes connections — 1 HTTP request = 1 worker
 * (no fan-out / no double-request).
 *
 * Env:
 *   WORKERS              — desired worker count (default 4)
 *   MW_ALLOW_SINGLE=1    — allow WORKERS<4 even when NODE_ENV=production (debug only)
 *   MW_WORKER_ID         — set on workers by primary (exposed in /api/health)
 *   MW_WORKER_COUNT      — set on workers by primary
 */

function resolveWorkerCount() {
  const raw = process.env.WORKERS;
  let n = raw != null && String(raw).trim() !== "" ? Number.parseInt(String(raw), 10) : 4;
  if (!Number.isFinite(n) || n < 1) n = 4;
  // D5: production always 4+ unless explicitly allowed single for debug
  if (process.env.NODE_ENV === "production" && process.env.MW_ALLOW_SINGLE !== "1") {
    if (n < 4) n = 4;
  }
  if (n > 16) n = 16;
  return n;
}

function installRealIpWrapper() {
  const origCreate = http.createServer.bind(http);

  // Wrap Next standalone HTTP server: derive client IP from the TCP socket
  // (unspoofable) and strip client-supplied forwarding headers so downstream
  // rate-limiting keys on the real peer address instead of attacker-controlled XFF.
  http.createServer = (...args) => {
    const handler = args.find((a) => typeof a === "function");
    const rest = args.filter((a) => typeof a !== "function");
    if (!handler) return origCreate(...args);
    const wrapped = (req, res) => {
      const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
      const xff = req.headers["x-forwarded-for"];
      const xRealIp = req.headers["x-real-ip"];
      const viaProxy = !!(xff || xRealIp);
      const isLoopbackProxy =
        socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
      // Trust forwarding headers only when the TCP peer is a local reverse proxy.
      // Direct/public sockets remain keyed by the unspoofable peer address.
      const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
      const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
      delete req.headers["x-9r-real-ip"];
      delete req.headers["x-forwarded-for"];
      delete req.headers["x-9r-via-proxy"];
      req.headers["x-9r-real-ip"] = ip;
      if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
      return handler(req, res);
    };
    const server = origCreate(...rest, wrapped);
    server.once("listening", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : process.env.PORT;
      if (!port) return;
      const request = http.get(`http://127.0.0.1:${port}/api/init`, (response) => response.resume());
      request.on("error", (error) => console.warn(`[Bootstrap] init probe failed: ${error.message}`));
    });
    return server;
  };
}

function forkWorker(slot, total) {
  const env = {
    ...process.env,
    MW_WORKER_ID: String(slot),
    MW_WORKER_COUNT: String(total),
  };
  return cluster.fork(env);
}

const isPrimary = typeof cluster.isPrimary === "boolean" ? cluster.isPrimary : cluster.isMaster;

if (isPrimary) {
  const workerCount = resolveWorkerCount();
  console.log(
    `[9router-mw] primary pid=${process.pid} forking workers=${workerCount} (WORKERS=${process.env.WORKERS || "default"})`
  );

  for (let i = 1; i <= workerCount; i++) {
    forkWorker(i, workerCount);
  }

  // ─── Dedicated SQLite writer ──────────────────────────────────────
  const writerPath = path.join(__dirname, "primary-writer.mjs");
  let writerProcess = null;

  function startWriter() {
    if (writerProcess) {
      try { writerProcess.kill(); } catch {}
    }
    writerProcess = fork(writerPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env },
    });

    writerProcess.on("message", (msg) => {
      if (msg?.type === "writer:ready") {
        console.log(`[writer] online pid=${msg.pid}`);
      } else if (msg?.type === "writer:pong") {
        global.__writerHealth = msg;
      }
    });

    writerProcess.on("exit", (code, signal) => {
      console.error(`[writer] exited code=${code} signal=${signal}, restarting in 2s`);
      setTimeout(startWriter, 2000);
    });

    writerProcess.stdout.on("data", (d) => process.stdout.write(`[writer] ${d}`));
    writerProcess.stderr.on("data", (d) => process.stderr.write(`[writer] ${d}`));
  }

  startWriter();

  // Poll writer health every 10s
  setInterval(() => {
    if (writerProcess && writerProcess.connected) {
      writerProcess.send({ type: "writer:ping" });
    }
  }, 10000).unref();

  // Graceful shutdown: writer first, then workers
  function shutdownCluster() {
    console.log("[9router-mw] shutting down cluster...");
    if (writerProcess) {
      writerProcess.send({ type: "shutdown" });
      setTimeout(() => { try { writerProcess.kill(); } catch {} }, 3000);
    }
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
  }
  process.on("SIGTERM", shutdownCluster);
  process.on("SIGINT", shutdownCluster);

  let nextSlot = workerCount + 1;
  cluster.on("exit", (worker, code, signal) => {
    const slot = nextSlot++;
    console.error(
      `[9router-mw] worker id=${worker.id} pid=${worker.process.pid} exited code=${code} signal=${signal}; forking replacement slot=${slot}`
    );
    forkWorker(slot, workerCount);
  });

  cluster.on("online", (worker) => {
    console.log(`[9router-mw] worker online id=${worker.id} pid=${worker.process.pid}`);
  });

  // Primary stays alive; workers own the HTTP listeners via cluster sharing.
} else {
  // F6: prod log defaults (D22) when unset — do not override explicit env
  if (process.env.NODE_ENV === "production") {
    if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = "warn";
    if (process.env.ENABLE_REQUEST_LOGS === undefined || process.env.ENABLE_REQUEST_LOGS === "") {
      process.env.ENABLE_REQUEST_LOGS = "false";
    }
  }
  if (!process.env.MW_WORKER_ID && cluster.worker) {
    process.env.MW_WORKER_ID = String(cluster.worker.id);
  }
  if (!process.env.MW_WORKER_COUNT) {
    process.env.MW_WORKER_COUNT = String(resolveWorkerCount());
  }
  console.log(
    `[9router-mw] worker start id=${process.env.MW_WORKER_ID} pid=${process.pid} count=${process.env.MW_WORKER_COUNT}`
  );
  installRealIpWrapper();
  require("./server.js");
}
