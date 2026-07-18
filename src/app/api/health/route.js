import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * Liveness probe for 9router-mw.
 * Multi-worker (Fase 3): exposes workerId + pid so ops can verify cluster distribution.
 * Sticky sessions not required for stateless API-key traffic.
 */
export async function GET() {
  const body = {
    ok: true,
    workerId: process.env.MW_WORKER_ID || null,
    pid: process.pid,
    workers: process.env.MW_WORKER_COUNT ? Number(process.env.MW_WORKER_COUNT) : null,
  };
  return NextResponse.json(body, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
