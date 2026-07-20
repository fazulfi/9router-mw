import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import { getMwRedis, getRedisBounds } from "@/lib/mw/deps.js";
import { projectLiveSnapshot, readRedisLiveSnapshot } from "@/lib/mw/readModel/redisReader.js";

export const dynamic = "force-dynamic";

const DEFAULT_HEARTBEAT_MS = 20_000;

const DEGRADED = Object.freeze({
  mode: "degraded",
  active: [],
  recent: [],
  lastError: null,
});

function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      Allow: "GET",
    },
  });
}

async function defaultVerifyAuth(request) {
  const auth = await requireMwDashboardAuth(request);
  return auth.ok === true;
}

async function defaultReadSnapshot() {
  try {
    const redis = await getMwRedis();
    if (!redis) return { ...DEGRADED };
    return await readRedisLiveSnapshot(redis, getRedisBounds());
  } catch {
    return { ...DEGRADED };
  }
}

/**
 * Authenticated same-origin SSE for MW dashboard (Phase 1).
 * Callable as createStreamHandler(request, deps) for tests, or via GET export.
 */
export async function createStreamHandler(request, deps = {}) {
  const method = String(request?.method || "GET").toUpperCase();
  if (method !== "GET") {
    return methodNotAllowed();
  }

  const verifyAuth = deps.verifyAuth ?? defaultVerifyAuth;
  const readSnapshot = deps.readSnapshot ?? defaultReadSnapshot;
  const heartbeatMs =
    typeof deps.heartbeatMs === "number" && deps.heartbeatMs > 0
      ? deps.heartbeatMs
      : DEFAULT_HEARTBEAT_MS;

  const authorized = await verifyAuth(request);
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const state = { closed: false, heartbeat: null };

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          state.closed = true;
          if (state.heartbeat) clearInterval(state.heartbeat);
        }
      };

      try {
        const raw = await readSnapshot();
        const dto = projectLiveSnapshot(raw && typeof raw === "object" ? raw : DEGRADED);
        enqueue(`data: ${JSON.stringify(dto)}\n\n`);
      } catch {
        enqueue(`data: ${JSON.stringify(DEGRADED)}\n\n`);
      }

      state.heartbeat = setInterval(() => {
        if (state.closed) {
          clearInterval(state.heartbeat);
          return;
        }
        enqueue(": ping\n\n");
      }, heartbeatMs);
      state.heartbeat?.unref?.();
    },
    cancel() {
      state.closed = true;
      if (state.heartbeat) clearInterval(state.heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function GET(request) {
  return createStreamHandler(request);
}
