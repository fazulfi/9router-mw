import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import { failedToLoadJson, jsonResponse } from "@/lib/mw/http.js";
import { getMwRedis } from "@/lib/mw/deps.js";
import {
  readWorkerObservability,
  SAFE_AGGREGATE_WORKER_FIELDS,
  SAFE_PER_WORKER_FIELDS,
} from "@/lib/mw/readModel/workerReader.js";

export const dynamic = "force-dynamic";

/**
 * Per-worker allowlisting — used at the route boundary to ensure only
 * safe fields reach the client.  Replicates the sanitizer contract
 * from dashboard/src/lib/sanitize.js without the cross-target import.
 */
function projectSafeAggregate(raw) {
  if (!raw || typeof raw !== "object") {
    return { availability: "unavailable", expectedCount: 0, freshCount: 0 };
  }
  const out = {};
  for (const key of SAFE_AGGREGATE_WORKER_FIELDS) {
    const v = raw[key];
    if (v != null) out[key] = v;
  }
  if (out.availability == null) out.availability = "unavailable";
  if (out.expectedCount == null) out.expectedCount = 0;
  if (out.freshCount == null) out.freshCount = 0;

  // Allowlist per-worker entries
  if (Array.isArray(raw.workers) && raw.workers.length > 0) {
    out.workers = raw.workers
      .map((w) => {
        if (!w || typeof w !== "object") return null;
        const safe = {};
        for (const k of SAFE_PER_WORKER_FIELDS) {
          const v = w[k];
          if (v != null) safe[k] = v;
        }
        // Require valid workerId (string), status (string), observedAt (number), ageMs (number)
        if (
          typeof safe.workerId !== "string" ||
          typeof safe.status !== "string" ||
          typeof safe.observedAt !== "number" ||
          typeof safe.ageMs !== "number"
        ) {
          return null;
        }
        return safe;
      })
      .filter(Boolean);
  }

  if (Array.isArray(raw.missingWorkerIds)) {
    // Bound and validate: only string IDs representing slot numbers 1..16
    const MAX_SLOT = 16;
    const bounded = raw.missingWorkerIds
      .filter((v) => typeof v === "string" && /^[1-9]$|^1[0-6]$/.test(v))
      .slice(0, MAX_SLOT);
    if (bounded.length > 0) out.missingWorkerIds = bounded.sort();
  }

  return out;
}

/**
 * Worker observability route — projects the reader DTO through a
 * strict per-worker allowlist (availability + expectedCount +
 * freshCount + per-worker workerId/status/observedAt/ageMs only).
 */
export function createWorkersHandler(deps = {}) {
  const resolveRedis = deps.getRedis ?? getMwRedis;
  const readWorkers = deps.readWorkerObservability ?? readWorkerObservability;
  const projectSafe = deps.projectSafeAggregate ?? projectSafeAggregate;

  return async function GET(request) {
    const auth = await requireMwDashboardAuth(request);
    if (!auth.ok) return auth.response;

    try {
      const redis = await resolveRedis();
      const workers = await readWorkers(redis);
      return jsonResponse(projectSafe(workers));
    } catch {
      return failedToLoadJson();
    }
  };
}

export const GET = createWorkersHandler();
