import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import { failedToLoadJson, jsonResponse } from "@/lib/mw/http.js";
import { getMwRedis, getRedisBounds } from "@/lib/mw/deps.js";
import { readRedisLiveSnapshot } from "@/lib/mw/readModel/redisReader.js";

export const dynamic = "force-dynamic";

const DEGRADED = Object.freeze({
  mode: "degraded",
  active: [],
  recent: [],
  lastError: null,
});

/**
 * Bounded Redis live snapshot for MW dashboard.
 */
export function createRedisHandler(deps = {}) {
  const resolveRedis = deps.getRedis ?? getMwRedis;
  const readRedis = deps.readRedisLiveSnapshot ?? readRedisLiveSnapshot;
  const resolveBounds = () => deps.redisBounds ?? getRedisBounds();

  return async function GET(request) {
    const auth = await requireMwDashboardAuth(request);
    if (!auth.ok) return auth.response;

    try {
      const redis = await resolveRedis();
      if (!redis) {
        return jsonResponse({ ...DEGRADED });
      }

      try {
        const snapshot = await readRedis(redis, resolveBounds());
        return jsonResponse(snapshot);
      } catch {
        return jsonResponse({ ...DEGRADED });
      }
    } catch {
      return failedToLoadJson();
    }
  };
}

export const GET = createRedisHandler();
