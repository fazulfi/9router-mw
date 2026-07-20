import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import { failedToLoadJson, jsonResponse } from "@/lib/mw/http.js";
import { getMwRedis } from "@/lib/mw/deps.js";
import { readWorkerObservability } from "@/lib/mw/readModel/workerReader.js";

export const dynamic = "force-dynamic";

/**
 * Lightweight authenticated health for MW dashboard.
 * No CORS *, no secrets.
 */
export function createHealthHandler(deps = {}) {
  const resolveRedis = deps.getRedis ?? getMwRedis;
  const readWorkers = deps.readWorkerObservability ?? readWorkerObservability;

  return async function GET(request) {
    const auth = await requireMwDashboardAuth(request);
    if (!auth.ok) return auth.response;

    try {
      const redis = await resolveRedis();
      let redisOk = false;
      let redisMode = "degraded";
      if (redis) {
        try {
          if (typeof redis.get === "function") {
            await redis.get("mw:health:ping");
            redisOk = true;
            redisMode = "ok";
          }
        } catch {
          redisOk = false;
          redisMode = "degraded";
        }
      }

      const workers = await readWorkers(redis);
      const workersDegraded =
        !workers ||
        workers.availability === "unavailable" ||
        workers.availability === "degraded";

      return jsonResponse({
        ok: true,
        degraded: !redisOk || workersDegraded,
        redis: { ok: redisOk, mode: redisMode },
        workers: {
          availability: workers?.availability || "unavailable",
        },
      });
    } catch {
      return failedToLoadJson();
    }
  };
}

export const GET = createHealthHandler();
