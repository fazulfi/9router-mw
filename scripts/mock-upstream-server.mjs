#!/usr/bin/env node
/**
 * F7 mock upstream — fixed latency + atomic counter.
 * Proves 1 client request → 1 upstream hit (no double-call).
 *
 * Listen: 127.0.0.1:18080 (override MOCK_UPSTREAM_PORT)
 * GET  /metrics  → { requests, inFlight, startedAt }
 * POST /v1/chat/completions → OpenAI-ish JSON after MOCK_LATENCY_MS (default 50)
 * GET  /health   → { ok: true }
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_UPSTREAM_PORT || 18080);
const HOST = process.env.MOCK_UPSTREAM_HOST || "127.0.0.1";
const LATENCY_MS = Math.max(0, Number(process.env.MOCK_LATENCY_MS || 50) || 50);

let requests = 0;
let inFlight = 0;
const startedAt = new Date().toISOString();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    connection: "keep-alive",
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (req.method === "GET" && (url === "/metrics" || url.startsWith("/metrics?"))) {
    return json(res, 200, { requests, inFlight, startedAt, latencyMs: LATENCY_MS });
  }
  if (req.method === "GET" && (url === "/health" || url === "/")) {
    return json(res, 200, { ok: true, mock: true });
  }

  // Drain body then respond after fixed latency
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) req.destroy();
  });
  req.on("end", () => {
    inFlight += 1;
    requests += 1;
    const n = requests;
    setTimeout(() => {
      inFlight = Math.max(0, inFlight - 1);
      if (url.includes("chat/completions") || req.method === "POST") {
        return json(res, 200, {
          id: `mock-${n}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "mock-upstream",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: `mock-ok-${n}` },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      return json(res, 200, { ok: true, n, path: url });
    }, LATENCY_MS);
  });
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(PORT, HOST, () => {
  console.log(
    `[mock-upstream] listening http://${HOST}:${PORT} latencyMs=${LATENCY_MS}`,
  );
});

function shutdown() {
  console.log(`[mock-upstream] shutdown requests=${requests}`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
