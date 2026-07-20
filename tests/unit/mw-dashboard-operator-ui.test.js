/**
 * Focused failing tests for operator-facing dashboard UX remediation.
 *
 * These contracts assert EXPECTED operator-UI behavior that the production
 * dashboard does NOT yet implement. They run RED (fail) on current code.
 *
 * Domains (per task scope):
 *   1. UX copy — no user-facing Phase / companion / internal-endpoint wording
 *   2. Worker presentation contract — no invented PIDs, hostnames, metrics
 *   3. Usage quiet / nonzero states — distinct absent vs active-zero handling
 *   4. Bounded Provider/Redis rendering controls — allowlisted key lists
 *   5. Connection state vocabulary — mapPageViewState completeness
 *
 * MUIST NOT DO: imported-only pure functions from lib/ (no JSX, no React hooks,
 * no DOM, no browser dependencies). Compatible with existing Vitest node env.
 */

import { describe, expect, it, vi } from "vitest";
import {
  formatCount,
  formatLastError,
  mapPageViewState,
  mapRedisMode,
  mapWorkerAvailability,
} from "../../dashboard/src/lib/state.js";
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  MW_API_ROOT,
  USAGE_PERIODS,
  buildApiPath,
  isEmptyPayload,
  isDegradedPayload,
  mapResponseStatus,
  mwGet,
  projectResource,
} from "../../dashboard/src/lib/api.js";
import {
  REDIS_ACTIVE_KEYS,
  REDIS_RECENT_KEYS,
  pickAllowlisted,
  sanitizeRedisSnapshot,
  sanitizeWorkersDto,
  stripSecrets,
} from "../../dashboard/src/lib/sanitize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ===================================================================
 * 1. UX COPY — NO Phase / companion / internal-endpoint wording
 *
 * The user rejected "Phase 1 companion" and "internal endpoint"
 * terminology in operator-facing UI. These helper strings are the
 * pure export surfaces that feed page copy. Assert they are clean.
 *
 * These tests FAIL (RED) because the current implementation still
 * contains the banned terms.
 * =================================================================== */

describe("UX copy — no Phase / companion / internal-endpoint wording", () => {
  it("mapWorkerAvailability('unavailable') detail omits 'companion' and 'Phase 1'", () => {
    const m = mapWorkerAvailability("unavailable");
    // FAILS: current detail reads "…This companion does not invent…"
    expect(m.detail).not.toMatch(/companion/i);
    expect(m.detail).not.toMatch(/phase\s*1/i);
  });

  it("mapWorkerAvailability('degraded') detail omits 'Phase 1' and 'companion'", () => {
    const m = mapWorkerAvailability("degraded");
    // FAILS: current detail reads "…available in Phase 1."
    expect(m.detail).not.toMatch(/phase\s*1/i);
    expect(m.detail).not.toMatch(/companion/i);
  });

  it("mapResponseStatus 401 message omits 'companion' and 'Phase 1'", () => {
    const mapped = mapResponseStatus(401);
    // FAILS: current message reads "…return to this companion view."
    expect(mapped.message).not.toMatch(/companion/i);
    expect(mapped.message).not.toMatch(/phase\s*1/i);
  });

  it("mwGet network-error message omits 'companion' and 'Phase 1'", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const result = await mwGet("health", { fetchImpl });
    // FAILS: current message reads "…could not reach companion API"
    expect(result.message).not.toMatch(/companion/i);
    expect(result.message).not.toMatch(/phase\s*1/i);
  });

  it("mapRedisMode detail strings are clean of banned terms", () => {
    for (const mode of ["redis", "degraded", "ok"]) {
      const m = mapRedisMode(mode);
      expect(m.detail).not.toMatch(/companion/i);
      expect(m.detail).not.toMatch(/phase\s*1/i);
      expect(m.detail).not.toMatch(/internal endpoint/i);
    }
  });

  it("formatLastError never leaks internal labels into user copy", () => {
    expect(formatLastError(null)).toBeNull();
    expect(formatLastError("transient upstream error")).toBe(
      "transient upstream error",
    );
    expect(formatLastError("leaked apiKey value")).not.toMatch(/companion/i);
    expect(formatLastError("leaked apiKey value")).not.toMatch(/phase\s*1/i);
  });
});

/* ===================================================================
 * 1b. RENDERED JSX COPY — no internal endpoint/implementation details
 *
 * The operator-facing pages must not show developer-facing wording such
 * as /mw/api/v1/* paths, EventSource, SSE, Vite base-path, public shell,
 * or HTML shell architecture in user-visible text.
 *
 * These tests read the actual JSX source files (not the internal lib/
 * constants) and fail if any forbidden pattern appears in a renderable
 * position (non-import, non-comment strings).
 * =================================================================== */

describe("Rendered JSX copy — no internal endpoint/impl details", () => {
  const PAGES_DIR = resolve(__dirname, "../../dashboard/src/pages");

  const FORBIDDEN_PATTERNS = [
    /\/mw\/api\/v1\b/,
    /EventSource/,
    /\bSSE\b/,
    /Vite\s+base/,
    /HTML shell/,
    /public shell/,
    /BASE_URL/,
  ];

  const ALLOWED_INTERNAL = [
    "useDashboardSSE",   // hook import name (not rendered)
    "EventSource is not available",  // only in hook, never rendered
  ];

  for (const file of ["Overview.jsx", "Settings.jsx"]) {
    const abs = resolve(PAGES_DIR, file);
    const src = fs.readFileSync(abs, "utf-8");

    for (const pattern of FORBIDDEN_PATTERNS) {
      const matches = [];
      const re = new RegExp(pattern.source, "gi");
      let m;
      while ((m = re.exec(src)) !== null) {
        // skip import lines
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        const lineEnd = src.indexOf("\n", m.index);
        const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
        const lineNum = src.slice(0, m.index).split("\n").length;

        const isImport = /^\s*import\s/.test(line);
        const isCommentBlock = /^\s*\*/.test(line.trim());
        const isLineComment = /^\s*\/\//.test(line.trim());
        if (isImport || isCommentBlock || isLineComment) continue;
        const isAllowedInternal = ALLOWED_INTERNAL.some((a) =>
          line.includes(a),
        );
        if (isAllowedInternal) continue;

        matches.push(`  line ${lineNum}: ${line.trim()}`);
      }
      it(`${file} has no rendered "${pattern.source}"`, () => {
        expect(matches).toEqual([]);
      });
    }
  }
});

/* ===================================================================
 * 2. WORKER PRESENTATION CONTRACT
 *
 * Workers must present honest availability only — never invented
 * process IDs, hostnames, CPU/memory gauges, or fake readiness.
 * The DTO shape is bounded to { availability, schemaVersion? }.
 * =================================================================== */

describe("Worker presentation contract", () => {
  it("sanitizeWorkersDto never invents pid, host, or fake metrics", () => {
    const dto = sanitizeWorkersDto({
      availability: "degraded",
      pid: 12345,
      host: "10.0.0.1",
      cpu: "12%",
      memory: "256MB",
      uptime: "3d",
    });
    expect(dto.availability).toBe("degraded");
    expect(dto.pid).toBeUndefined();
    expect(dto.host).toBeUndefined();
    expect(dto.cpu).toBeUndefined();
    expect(dto.memory).toBeUndefined();
    expect(dto.uptime).toBeUndefined();
  });

  it("sanitizeWorkersDto preserves schemaVersion when backend reports it", () => {
    const dto = sanitizeWorkersDto({
      availability: "ok",
      schemaVersion: 2,
    });
    expect(dto.availability).toBe("ok");
    expect(dto.schemaVersion).toBe(2);
  });

  it("sanitizeWorkersDto defaults to unavailable when input is absent", () => {
    expect(sanitizeWorkersDto(null).availability).toBe("unavailable");
    expect(sanitizeWorkersDto(undefined).availability).toBe("unavailable");
    expect(sanitizeWorkersDto({}).availability).toBe("unavailable");
  });

  it("projectResource('workers') strips pid/host and retains only honest fields", () => {
    const dto = projectResource("workers", {
      availability: "degraded",
      schemaVersion: 1,
      pid: 42,
      host: "w1",
      internalSecret: "cluster-key",
    });
    expect(dto).toEqual({
      availability: "degraded",
      expectedCount: 0,
      freshCount: 0,
      schemaVersion: 1,
    });
    // No secret fields survive
    expect(JSON.stringify(dto)).not.toMatch(/internalSecret/i);
  });
});

/* ===================================================================
 * 3. USAGE QUIET / NONZERO STATE HANDLING
 *
 * Operator dashboard must distinguish "quiet cluster" (all counters
 * genuinely zero) from "absent data" (null/undefined). The formatCount
 * helper and isEmptyPayload for usage enforce this distinction.
 * =================================================================== */

describe("Usage quiet / nonzero state handling", () => {
  it("formatCount(0) returns '0' (active zero) not '—' (absent/null)", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount("0")).toBe("0");
    // Absent data corresponds to dash
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount("")).toBe("—");
  });

  it("isEmptyPayload('usage') identifies all-zeros as quiet (empty)", () => {
    expect(
      isEmptyPayload("usage", {
        period: "24h",
        totalRequests: 0,
        totalTokens: 0,
        successCount: 0,
        errorCount: 0,
      }),
    ).toBe(true);
  });

  it("isEmptyPayload('usage') identifies partial nonzero as non-empty", () => {
    // Even a single request makes the window active
    expect(
      isEmptyPayload("usage", {
        period: "24h",
        totalRequests: 1,
        totalTokens: 0,
        successCount: 0,
        errorCount: 0,
      }),
    ).toBe(false);
  });

  it("isDegradedPayload('usage') returns false for usage (no degradation)", () => {
    expect(
      isDegradedPayload("usage", {
        period: "24h",
        totalRequests: 0,
        totalTokens: 0,
        successCount: 0,
        errorCount: 0,
      }),
    ).toBe(false);
    expect(isDegradedPayload("usage", null)).toBe(false);
  });

  it("non-numeric usage values default to zero via sanitizeUsageDto", async () => {
    // Fetch a usage with string values and verify they coerce
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        period: "7d",
        totalRequests: "42",
        totalTokens: "9999",
        successCount: "40",
        errorCount: "2",
      }),
    }));
    const result = await mwGet("usage", {
      query: { period: "7d" },
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.data.totalRequests).toBe(42);
    expect(result.data.totalTokens).toBe(9999);
    expect(result.data.successCount).toBe(40);
    expect(result.data.errorCount).toBe(2);
  });

  it("usage empty payload triggers empty phase via mapPageViewState", () => {
    const view = mapPageViewState(
      {
        kind: "ok",
        empty: true,
        message: "No data yet",
        data: {
          period: "24h",
          totalRequests: 0,
          totalTokens: 0,
          successCount: 0,
          errorCount: 0,
        },
      },
      "ready",
    );
    expect(view.showEmpty).toBe(true);
    expect(view.showData).toBe(false);
    expect(view.phase).toBe("empty");
  });
});

/* ===================================================================
 * 4. BOUNDED REDIS RENDERING CONTROLS
 *
 * Redis active/recent rows must be allowlisted — never emit
 * apiKey, accessToken, credential, or other secret fields.
 * The key lists themselves are bounded short arrays.
 * =================================================================== */

describe("Bounded Redis rendering controls", () => {
  it("REDIS_ACTIVE_KEYS is bounded to exactly 3 fields", () => {
    expect(REDIS_ACTIVE_KEYS).toEqual(["connectionId", "model", "count"]);
    expect(REDIS_ACTIVE_KEYS.length).toBeLessThanOrEqual(4);
  });

  it("REDIS_RECENT_KEYS is bounded to exactly 7 fields", () => {
    expect(REDIS_RECENT_KEYS).toEqual([
      "timestamp",
      "provider",
      "model",
      "connectionId",
      "endpoint",
      "status",
      "tokens",
    ]);
    expect(REDIS_RECENT_KEYS.length).toBeLessThanOrEqual(8);
  });

  it("REDIS_ACTIVE_KEYS has no secret field names", () => {
    const joined = REDIS_ACTIVE_KEYS.join(" ");
    expect(joined).not.toMatch(/apiKey|accessToken|credential|password|secret/i);
  });

  it("REDIS_RECENT_KEYS has no secret field names", () => {
    const joined = REDIS_RECENT_KEYS.join(" ");
    expect(joined).not.toMatch(/apiKey|accessToken|credential|password|secret/i);
  });

  it("sanitizeRedisSnapshot strips secret fields from active rows", () => {
    const snap = sanitizeRedisSnapshot({
      mode: "redis",
      active: [
        {
          connectionId: "c1",
          model: "gpt",
          count: 3,
          apiKey: "sk-leaked",
          accessToken: "tok-leaked",
        },
      ],
      recent: [],
      lastError: null,
    });
    expect(snap.active).toHaveLength(1);
    expect(snap.active[0].apiKey).toBeUndefined();
    expect(snap.active[0].accessToken).toBeUndefined();
    expect(snap.active[0].connectionId).toBe("c1");
    expect(snap.active[0].count).toBe(3);
  });

  it("sanitizeRedisSnapshot strips secret fields from recent rows", () => {
    const snap = sanitizeRedisSnapshot({
      mode: "redis",
      active: [],
      recent: [
        {
          timestamp: "2026-07-20T00:00:00Z",
          provider: "openai",
          model: "gpt",
          connectionId: "c1",
          endpoint: "/v1/chat",
          status: "ok",
          tokens: 12,
          credential: { password: "nope" },
          apiKey: "sk-embedded",
        },
      ],
      lastError: null,
    });
    const row = snap.recent[0];
    expect(row.apiKey).toBeUndefined();
    expect(row.credential).toBeUndefined();
    expect(row.provider).toBe("openai");
    expect(row.status).toBe("ok");
  });
});

/* ===================================================================
 * 5. CONNECTION STATE VOCABULARY
 *
 * mapPageViewState must handle every expected phase with correct
 * showData / showEmpty flags and appropriate banner tones.
 * =================================================================== */

describe("Connection state vocabulary", () => {
  it("loading phase hides data and shows no banner", () => {
    const view = mapPageViewState(null, "loading");
    expect(view.phase).toBe("loading");
    expect(view.showData).toBe(false);
    expect(view.showEmpty).toBe(false);
    expect(view.banner).toBeNull();
  });

  it("idle phase hides data", () => {
    const view = mapPageViewState(null, "idle");
    expect(view.phase).toBe("idle");
    expect(view.showData).toBe(false);
  });

  it("unauthenticated phase has danger banner and no data", () => {
    const view = mapPageViewState(
      { kind: "unauthenticated", message: "Session expired" },
      "ready",
    );
    expect(view.phase).toBe("unauthenticated");
    expect(view.banner.tone).toBe("danger");
    expect(view.showData).toBe(false);
    expect(view.showEmpty).toBe(false);
  });

  it("error phase has danger banner and no data", () => {
    const view = mapPageViewState(
      { kind: "error", message: "Backend unavailable" },
      "ready",
    );
    expect(view.phase).toBe("error");
    expect(view.banner.tone).toBe("danger");
    expect(view.showData).toBe(false);
  });

  it("degraded with content shows data", () => {
    const view = mapPageViewState(
      {
        kind: "degraded",
        degraded: true,
        empty: false,
        message: "Some signals degraded",
      },
      "ready",
    );
    expect(view.phase).toBe("degraded");
    expect(view.banner.tone).toBe("warning");
    expect(view.showData).toBe(true);
    expect(view.showEmpty).toBe(false);
  });

  it("degraded with empty content shows empty", () => {
    const view = mapPageViewState(
      {
        kind: "degraded",
        degraded: true,
        empty: true,
        message: "Degraded and empty",
      },
      "ready",
    );
    expect(view.phase).toBe("degraded");
    expect(view.showData).toBe(false);
    expect(view.showEmpty).toBe(true);
  });

  it("ok phase shows data with no banner", () => {
    const view = mapPageViewState({ kind: "ok", empty: false }, "ready");
    expect(view.phase).toBe("ok");
    expect(view.banner).toBeNull();
    expect(view.showData).toBe(true);
    expect(view.showEmpty).toBe(false);
  });
});

/* ===================================================================
 * 6. HTML TITLE — no "Companion" / internal Phase wording
 *
 * The <title> in dashboard/index.html must be product-only. The user
 * explicitly rejected any user-facing "Companion" or "Phase 1" copy.
 * =================================================================== */

describe("HTML title — no Companion / Phase wording", () => {
  const DASHBOARD_DIR = resolve(__dirname, "../../dashboard");
  const htmlPath = resolve(DASHBOARD_DIR, "index.html");

  it("title contains no 'Companion' copy", () => {
    const html = fs.readFileSync(htmlPath, "utf-8");
    const match = html.match(/<title>(.*?)<\/title>/i);
    expect(match).not.toBeNull();
    const title = match[1];
    // FAILS: current title is "9router MW · Companion"
    expect(title).not.toMatch(/companion/i);
  });

  it("title contains no 'Phase' or 'Phase 1' copy", () => {
    const html = fs.readFileSync(htmlPath, "utf-8");
    const match = html.match(/<title>(.*?)<\/title>/i);
    expect(match).not.toBeNull();
    const title = match[1];
    expect(title).not.toMatch(/phase\s*\d*/i);
  });
});

/* ===================================================================
 * 7. ARIA CONTROLS TARGET — provider-list-panel must have a matching id
 *
 * The Providers disclosure button has aria-controls="provider-list-panel"
 * but no element in the rendered scope carries id="provider-list-panel".
 * =================================================================== */

describe("ARIA controls target — provider-list-panel id must exist", () => {
  const PAGES_DIR = resolve(__dirname, "../../dashboard/src/pages");
  const providersPath = resolve(PAGES_DIR, "Providers.jsx");

  it("aria-controls='provider-list-panel' references an existing element id", () => {
    const src = fs.readFileSync(providersPath, "utf-8");
    // The button has aria-controls="provider-list-panel"
    expect(src).toContain('aria-controls="provider-list-panel"');
    // FAILS: there is no element with id="provider-list-panel" in this file
    expect(src).toContain('id="provider-list-panel"');
  });

  it("the controlled element id is on a real container, not the controlling button", () => {
    const src = fs.readFileSync(providersPath, "utf-8");
    const idLine = src.split("\n").find((l) => l.includes('id="provider-list-panel"'));
    // When the id exists, it must NOT be on the same element as the aria-controls button
    if (idLine) {
      expect(idLine).not.toMatch(/^[\s]*<button/);
    }
    // If no id found yet (test 1 fails), this test naturally shows the gap
    expect(idLine).toBeTruthy();
  });
});
