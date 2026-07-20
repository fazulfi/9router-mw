import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import { failedToLoadJson, jsonResponse } from "@/lib/mw/http.js";
import { getMwRedis, getRedisBounds } from "@/lib/mw/deps.js";
import { readRedisLiveSnapshot } from "@/lib/mw/readModel/redisReader.js";
import { readWorkerObservability } from "@/lib/mw/readModel/workerReader.js";

export const dynamic = "force-dynamic";

/**
 * Bounded overview composition: redis + workers, no secrets.
 */
export function createOverviewHandler(deps = {}) {
  const resolveRedis = deps.getRedis ?? getMwRedis;
  const readRedis = deps.readRedisLiveSnapshot ?? readRedisLiveSnapshot;
  const readWorkers = deps.readWorkerObservability ?? readWorkerObservability;
  const resolveBounds = () => deps.redisBounds ?? getRedisBounds();

  return async function GET(request) {
    const auth = await requireMwDashboardAuth(request);
    if (!auth.ok) return auth.response;

    try {
      const redis = await resolveRedis();
      let live = {
        mode: "degraded",
        active: [],
        recent: [],
        lastError: null,
      };
      if (redis) {
        try {
          live = await readRedis(redis, resolveBounds());
        } catch {
          live = {
            mode: "degraded",
            active: [],
            recent: [],
            lastError: null,
          };
        }
      }

      const workers = await readWorkers(redis);

      return jsonResponse({
        redis: {
          mode: live.mode,
          activeCount: Array.isArray(live.active) ? live.active.length : 0,
          recentCount: Array.isArray(live.recent) ? live.recent.length : 0,
          lastError: live.lastError ?? null,
        },
        workers: {
          availability: workers?.availability || "unavailable",
        },
      });
    } catch {
      return failedToLoadJson();
    }
  };
}

export const GET = createOverviewHandler();
