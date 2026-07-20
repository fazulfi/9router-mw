import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import {
  badRequestJson,
  failedToLoadJson,
  jsonResponse,
} from "@/lib/mw/http.js";
import {
  getMwUsageStats,
  isAllowedUsagePeriod,
  projectUsageStats,
} from "@/lib/mw/deps.js";

export const dynamic = "force-dynamic";

const DEFAULT_PERIOD = "24h";

/**
 * Usage aggregates — period allowlist 24h|7d|30d only.
 * Projects/strips to safe fields; never raw rows.
 */
export function createUsageHandler(deps = {}) {
  const loadUsage = deps.getUsageStats ?? getMwUsageStats;

  return async function GET(request) {
    const auth = await requireMwDashboardAuth(request);
    if (!auth.ok) return auth.response;

    try {
      let period = DEFAULT_PERIOD;
      try {
        const url = new URL(request.url || "http://localhost/mw/api/v1/usage");
        const raw = url.searchParams.get("period");
        if (raw != null && raw !== "") {
          if (!isAllowedUsagePeriod(raw)) {
            return badRequestJson("Invalid period");
          }
          period = raw;
        }
      } catch {
        period = DEFAULT_PERIOD;
      }

      const stats = await loadUsage(period);
      const projected = projectUsageStats(stats, period);
      return jsonResponse(projected);
    } catch {
      return failedToLoadJson();
    }
  };
}

export const GET = createUsageHandler();
