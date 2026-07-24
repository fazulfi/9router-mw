import { NextResponse } from "next/server";
import { pingRedis, getRedis, getRedisHealthSnapshot } from "open-sse/services/redisClient.js";
import { getHotPathAgentInfo } from "open-sse/utils/proxyFetch.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * Liveness probe for 9router-mw.
 * Fase 3: workerId + pid for cluster distribution.
 * Fase 4: redis ping (fail-open degraded mode reported, never fails liveness).
 * Fase 6: hotpath undici + sqlite driver snapshot (best-effort).
 */
export async function GET() {
  let redis = {
    ok: false,
    mode: "degraded",
    latencyMs: -1,
    error: null,
    ...getRedisHealthSnapshot(),
  };

  try {
    const ping = await pingRedis();
    redis = {
      ok: ping.ok,
      mode: ping.mode,
      latencyMs: ping.latencyMs,
      error: ping.error,
      ...getRedisHealthSnapshot(),
    };
  } catch (err) {
    redis = {
      ok: false,
      mode: "degraded",
      latencyMs: -1,
      error: err?.message || String(err),
      ...getRedisHealthSnapshot(),
    };
  }

  // Writer health from Redis (shared by dedicated writer process via primary-writer.mjs)
  let writer = { ok: false, pid: null, uptime: null, status: "unavailable" };
  try {
    const r = await getRedis();
    if (r) {
      const raw = await r.get("mw:writer:health");
      if (raw) {
        writer = { ...JSON.parse(raw), status: "online" };
      }
    }
  } catch {
    /* writer status not critical for liveness */
  }

  let hotpath = {
    undici: getHotPathAgentInfo(),
    sqlite: { driver: null, journalMode: null },
  };
  try {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    let journalMode = null;
    try {
      if (adapter?.raw && typeof adapter.raw.pragma === "function") {
        journalMode = adapter.raw.pragma("journal_mode", { simple: true });
      } else if (typeof adapter?.get === "function") {
        const row = adapter.get("PRAGMA journal_mode");
        journalMode = row?.journal_mode || row?.["journal_mode"] || null;
      }
    } catch {
      /* ignore */
    }
    hotpath.sqlite = { driver: adapter?.driver || null, journalMode: journalMode || null };
  } catch (err) {
    hotpath.sqlite = { driver: null, journalMode: null, error: err?.message || String(err) };
  }

  const body = {
    ok: true,
    workerId: process.env.MW_WORKER_ID || null,
    pid: process.pid,
    workers: process.env.MW_WORKER_COUNT ? Number(process.env.MW_WORKER_COUNT) : null,
    redis,
    hotpath,
    writer,
  };
  return NextResponse.json(body, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
