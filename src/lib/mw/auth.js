import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { unauthorizedJson } from "@/lib/mw/http.js";

function extractToken(requestOrToken) {
  if (typeof requestOrToken === "string") return requestOrToken;
  if (!requestOrToken || typeof requestOrToken !== "object") return null;
  try {
    return requestOrToken.cookies?.get?.("auth_token")?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * JWT-only fail-closed guard for /mw/api/* routes.
 * Accepts a request-like object with cookies.get("auth_token") or a token string.
 * @returns {Promise<{ ok: true } | { ok: false, response: Response }>}
 */
export async function requireMwDashboardAuth(requestOrToken) {
  const token = extractToken(requestOrToken);
  if (!token) {
    return { ok: false, response: unauthorizedJson() };
  }
  const valid = await verifyDashboardAuthToken(token);
  if (!valid) {
    return { ok: false, response: unauthorizedJson() };
  }
  return { ok: true };
}
