import { requireMwDashboardAuth } from "@/lib/mw/auth.js";
import { failedToLoadJson, jsonResponse } from "@/lib/mw/http.js";
import { getMwReadOnlySqlite } from "@/lib/mw/deps.js";
import { readProviderSummary } from "@/lib/mw/readModel/sqliteReader.js";

export const dynamic = "force-dynamic";

/**
 * Provider summary via strict read-only SQLite adapter.
 * Degrades to empty list when adapter unavailable (no migrations).
 */
export function createProvidersHandler(deps = {}) {
  const resolveAdapter = deps.getReadOnlySqlite ?? getMwReadOnlySqlite;
  const readProviders = deps.readProviderSummary ?? readProviderSummary;

  return async function GET(request) {
    const auth = await requireMwDashboardAuth(request);
    if (!auth.ok) return auth.response;

    let adapter = null;
    try {
      adapter = await resolveAdapter();
      if (!adapter || adapter.readOnly !== true) {
        return jsonResponse({ providers: [], mode: "degraded" });
      }

      const providers = await readProviders(adapter);
      return jsonResponse({
        providers: Array.isArray(providers) ? providers : [],
        mode: "ok",
      });
    } catch {
      return failedToLoadJson();
    } finally {
      if (adapter && typeof adapter.close === "function") {
        try {
          adapter.close();
        } catch {
          /* ignore */
        }
      }
    }
  };
}

export const GET = createProvidersHandler();
