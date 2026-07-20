/**
 * Same-origin MW API client — GET-only, credentials included.
 * All paths under /mw/api/v1/* (never /api/usage/stream).
 */

import {
  sanitizeOverviewDto,
  sanitizeProvidersDto,
  sanitizeRedisSnapshot,
  sanitizeUsageDto,
  sanitizeWorkersDto,
  stripSecrets,
} from "./sanitize.js";

/** Fixed API root — companion SPA is always served under /mw/ */
export const MW_API_ROOT = "/mw/api/v1";

/** Allowed usage periods (backend allowlist). */
export const USAGE_PERIODS = Object.freeze(["24h", "7d", "30d"]);

/**
 * Build a same-origin MW API path.
 * @param {string} resource - e.g. "overview", "usage"
 * @param {Record<string, string|number|undefined|null>} [query]
 * @returns {string}
 */
export function buildApiPath(resource, query) {
  const clean = String(resource || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!clean || clean.includes("..") || clean.includes("//")) {
    throw new Error("Invalid API resource");
  }
  // Refuse legacy stream path fragments
  if (clean === "api/usage/stream" || clean.startsWith("api/")) {
    throw new Error("Only /mw/api/v1/* endpoints are allowed");
  }

  let path = `${MW_API_ROOT}/${clean}`;
  if (query && typeof query === "object") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) path = `${path}?${qs}`;
  }
  return path;
}

/**
 * SSE stream URL — only /mw/api/v1/stream.
 * @returns {string}
 */
export function buildStreamUrl() {
  return buildApiPath("stream");
}

/**
 * @param {string} period
 * @returns {boolean}
 */
export function isAllowedUsagePeriod(period) {
  return USAGE_PERIODS.includes(period);
}

/**
 * Map HTTP status / body into a stable client status.
 * @param {number} status
 * @param {unknown} [body]
 * @returns {{ kind: 'ok'|'unauthenticated'|'error'|'empty'|'degraded', message: string, status: number }}
 */
export function mapResponseStatus(status, body) {
  if (status === 401) {
    return {
      kind: "unauthenticated",
      message:
        "Sign-in required. Open the main 9router dashboard, sign in there, then return here. This page does not collect credentials.",
      status: 401,
    };
  }
  if (status === 403) {
    return {
      kind: "unauthenticated",
      message: "Access denied. Use the main dashboard session to continue.",
      status: 403,
    };
  }
  if (status >= 500) {
    const msg =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : "Failed to load";
    return { kind: "error", message: msg, status };
  }
  if (status >= 400) {
    const msg =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : "Request failed";
    return { kind: "error", message: msg, status };
  }
  return { kind: "ok", message: "ok", status };
}

/**
 * Detect empty-ish payloads for honest empty states.
 * @param {string} resource
 * @param {unknown} data
 * @returns {boolean}
 */
export function isEmptyPayload(resource, data) {
  if (data == null) return true;
  if (resource === "providers") {
    const list = data?.providers;
    return !Array.isArray(list) || list.length === 0;
  }
  if (resource === "redis") {
    const active = data?.active;
    const recent = data?.recent;
    const noActive = !Array.isArray(active) || active.length === 0;
    const noRecent = !Array.isArray(recent) || recent.length === 0;
    return noActive && noRecent && data?.mode === "degraded";
  }
  if (resource === "usage") {
    return (
      Number(data?.totalRequests) === 0 &&
      Number(data?.totalTokens) === 0 &&
      Number(data?.successCount) === 0 &&
      Number(data?.errorCount) === 0
    );
  }
  return false;
}

/**
 * Detect degraded signals without inventing metrics.
 * @param {string} resource
 * @param {unknown} data
 * @returns {boolean}
 */
export function isDegradedPayload(resource, data) {
  if (!data || typeof data !== "object") return false;
  if (resource === "workers") {
    return (
      data.availability === "degraded" ||
      data.availability === "partial" ||
      data.availability === "unavailable"
    );
  }
  if (resource === "redis" || resource === "providers") {
    return data.mode === "degraded";
  }
  if (resource === "overview") {
    return (
      data.redis?.mode === "degraded" ||
      data.workers?.availability === "degraded" ||
      data.workers?.availability === "partial" ||
      data.workers?.availability === "unavailable"
    );
  }
  if (resource === "health") {
    return data.degraded === true;
  }
  return false;
}

/**
 * Apply resource-specific sanitizers after stripSecrets.
 * @param {string} resource
 * @param {unknown} raw
 */
export function projectResource(resource, raw) {
  const base = stripSecrets(raw);
  switch (resource) {
    case "overview":
      return sanitizeOverviewDto(base);
    case "providers":
      return sanitizeProvidersDto(base);
    case "redis":
      return sanitizeRedisSnapshot(base);
    case "workers":
      return sanitizeWorkersDto(base);
    case "usage":
      return sanitizeUsageDto(base);
    case "health":
      return base && typeof base === "object" ? base : {};
    default:
      return base;
  }
}

/**
 * GET JSON from /mw/api/v1/*
 * @param {string} resource
 * @param {{ query?: Record<string, string|number>, signal?: AbortSignal, fetchImpl?: typeof fetch }} [options]
 */
export async function mwGet(resource, options = {}) {
  const { query, signal, fetchImpl = globalThis.fetch } = options;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const path = buildApiPath(resource, query);
  let response;
  try {
    response = await fetchImpl(path, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return {
      ok: false,
      status: 0,
      kind: "error",
      message: "Network error — the API could not be reached. Check your connection and retry.",
      data: null,
      empty: true,
      degraded: false,
    };
  }

  let body = null;
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    try {
      const text = await response.text();
      body = text ? { error: text.slice(0, 200) } : null;
    } catch {
      body = null;
    }
  }

  const mapped = mapResponseStatus(response.status, body);
  if (mapped.kind !== "ok") {
    return {
      ok: false,
      status: mapped.status,
      kind: mapped.kind,
      message: mapped.message,
      data: null,
      empty: true,
      degraded: false,
    };
  }

  const data = projectResource(resource, body);
  const empty = isEmptyPayload(resource, data);
  const degraded = isDegradedPayload(resource, data);

  return {
    ok: true,
    status: response.status,
    kind: degraded ? "degraded" : empty ? "empty" : "ok",
    message: degraded
      ? "Some signals are degraded"
      : empty
        ? "No data yet"
        : "ok",
    data,
    empty,
    degraded,
  };
}

export async function fetchOverview(opts) {
  return mwGet("overview", opts);
}

export async function fetchProviders(opts) {
  return mwGet("providers", opts);
}

export async function fetchRedis(opts) {
  return mwGet("redis", opts);
}

export async function fetchWorkers(opts) {
  return mwGet("workers", opts);
}

/**
 * @param {string} [period]
 * @param {object} [opts]
 */
export async function fetchUsage(period = "24h", opts = {}) {
  const safe = isAllowedUsagePeriod(period) ? period : "24h";
  return mwGet("usage", { ...opts, query: { period: safe } });
}

export async function fetchHealth(opts) {
  return mwGet("health", opts);
}
