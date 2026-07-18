import { NextResponse } from "next/server";
import { pingRedis, getRedisHealthSnapshot } from "open-sse/services/redisClient.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * Liveness probe for 9router-mw.
 * Fase 3: workerId + pid for cluster distribution.
 * Fase 4: redis ping (fail-open degraded mode reported, never fails liveness).
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

  const body = {
    ok: true,
    workerId: process.env.MW_WORKER_ID || null,
    pid: process.pid,
    workers: process.env.MW_WORKER_COUNT ? Number(process.env.MW_WORKER_COUNT) : null,
    redis,
  };
  return NextResponse.json(body, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
