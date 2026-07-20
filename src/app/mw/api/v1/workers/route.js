import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import { failedToLoadJson, jsonResponse } from "@/lib/mw/http.js";
import { getMwRedis } from "@/lib/mw/deps.js";
import { readWorkerObservability } from "@/lib/mw/readModel/workerReader.js";

export const dynamic = "force-dynamic";

/**
 * Honest worker observability — unavailable/degraded only.
 */
export function createWorkersHandler(deps = {}) {
  const resolveRedis = deps.getRedis ?? getMwRedis;
  const readWorkers = deps.readWorkerObservability ?? readWorkerObservability;

  return async function GET(request) {
    const auth = await requireMwDashboardAuth(request);
    if (!auth.ok) return auth.response;

    try {
      const redis = await resolveRedis();
      const workers = await readWorkers(redis);
      return jsonResponse({
        availability: workers?.availability || "unavailable",
        ...(workers?.schemaVersion != null
          ? { schemaVersion: workers.schemaVersion }
          : {}),
      });
    } catch {
      return failedToLoadJson();
    }
  };
}

export const GET = createWorkersHandler();
