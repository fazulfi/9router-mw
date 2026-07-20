/**
 * Pure UI state mapping helpers (no DOM / React).
 */

/**
 * Human-readable worker availability copy — honest, no fabricated metrics.
 * @param {string|null|undefined} availability
 * @returns {{ label: string, tone: 'neutral'|'warning'|'danger'|'ok', detail: string }}
 */
export function mapWorkerAvailability(availability) {
  const value = String(availability || "unavailable").toLowerCase();
  if (value === "degraded") {
    return {
      label: "Partial",
      tone: "warning",
      detail:
        "Worker observability is partial. Process IDs, hostnames, and live load metrics are not reported here.",
    };
  }
  if (value === "ok" || value === "available" || value === "healthy") {
    return {
      label: "Available",
      tone: "ok",
      detail: "Worker observability reports availability.",
    };
  }
  return {
    label: "Unavailable",
    tone: "danger",
    detail:
      "Worker observability is unavailable. This view does not invent process IDs, hostnames, or load metrics — only what the backend reports is shown.",
  };
}

/**
 * Redis mode badge mapping.
 * @param {string|null|undefined} mode
 */
export function mapRedisMode(mode) {
  const value = String(mode || "degraded").toLowerCase();
  if (value === "redis" || value === "ok") {
    return {
      label: value === "ok" ? "OK" : "Redis",
      tone: "ok",
      detail: "Live snapshot is reading from Redis.",
    };
  }
  return {
    label: "Degraded",
    tone: "warning",
    detail: "Redis live snapshot is degraded or unavailable.",
  };
}

/**
 * Normalize fetch result into page-level view model flags.
 * @param {{ kind?: string, message?: string, empty?: boolean, degraded?: boolean, data?: unknown }|null} result
 * @param {'idle'|'loading'|'ready'} loadState
 */
export function mapPageViewState(result, loadState = "ready") {
  if (loadState === "loading") {
    return {
      phase: "loading",
      banner: null,
      showEmpty: false,
      showData: false,
    };
  }
  if (loadState === "idle" || result == null) {
    return {
      phase: "idle",
      banner: null,
      showEmpty: false,
      showData: false,
    };
  }

  if (result.kind === "unauthenticated") {
    return {
      phase: "unauthenticated",
      banner: {
        tone: "danger",
        title: "Sign-in required",
        message: result.message,
      },
      showEmpty: false,
      showData: false,
    };
  }

  if (result.kind === "error") {
    return {
      phase: "error",
      banner: {
        tone: "danger",
        title: "Could not load",
        message: result.message || "Failed to load",
      },
      showEmpty: false,
      showData: false,
    };
  }

  if (result.degraded || result.kind === "degraded") {
    return {
      phase: "degraded",
      banner: {
        tone: "warning",
        title: "Degraded",
        message: result.message || "Some signals are degraded",
      },
      showEmpty: Boolean(result.empty),
      showData: !result.empty,
    };
  }

  if (result.empty || result.kind === "empty") {
    return {
      phase: "empty",
      banner: null,
      showEmpty: true,
      showData: false,
    };
  }

  return {
    phase: "ok",
    banner: null,
    showEmpty: false,
    showData: true,
  };
}

/**
 * Format a compact integer for UI.
 * @param {unknown} value
 * @returns {string}
 */
export function formatCount(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Central connection state labels for SSE and dashboard status.
 * Maps internal state keys to human-readable labels.
 * @param {string|null|undefined} state
 * @returns {string}
 */
export function mapConnectionLabel(state) {
  const map = {
    idle: "Starting",
    connecting: "Connecting",
    open: "Live",
    error: "Reconnecting",
    closed: "Offline",
    unauthenticated: "Sign in",
  };
  return map[String(state).toLowerCase()] || String(state);
}

/**
 * Safe display of lastError — never render objects with secret keys.
 * @param {unknown} lastError
 * @returns {string|null}
 */
export function formatLastError(lastError) {
  if (lastError == null || lastError === "") return null;
  if (typeof lastError === "string") {
    if (/apiKey|accessToken|credential|password|internalSecret/i.test(lastError)) {
      return "An error was reported (details withheld).";
    }
    return lastError.slice(0, 240);
  }
  return "An error was reported (non-text payload withheld).";
}
