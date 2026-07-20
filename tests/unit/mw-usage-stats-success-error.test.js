import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB driver so getUsageStats can run without a real DB.
// The stub returns a fake adapter with a fixed usageHistory / usageDaily
// dataset.  No raw rows are exposed; only the bounded aggregates the
// post-fix code must produce.
//
// Why: today getUsageStats(src/lib/db/repos/usageRepo.js) never computes
// successCount / errorCount from the status column, so the bounded
// DTO it returns has neither field.  The MW dashboard therefore reports
// zero outcomes even when status-bearing rows exist in usageHistory.
// The fix is bounded: derive success/error counts from existing
// usageHistory.status values inside the same UTC cutoff already used for
// totalPromptTokens / totalCompletionTokens.  These tests pin the
// post-fix DTO contract; they MUST fail (RED) against the current code.

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
  getProviderConnections: vi.fn(),
  getApiKeys: vi.fn(),
  getProviderNodes: vi.fn(),
  getPendingSnapshot: vi.fn(),
  getRecentEntries: vi.fn(),
  getLastErrorProvider: vi.fn(),
}));

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
  getAdapterSync: vi.fn(),
}));

vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/lib/db/repos/nodesRepo.js", () => ({
  getProviderNodes: mocks.getProviderNodes,
}));

vi.mock("open-sse/services/liveUsageState.js", () => ({
  adjustPending: vi.fn(),
  getPendingSnapshot: mocks.getPendingSnapshot,
  pushRecentEntry: vi.fn(),
  getRecentEntries: mocks.getRecentEntries,
  getLastErrorProvider: mocks.getLastErrorProvider,
}));

function buildFakeAdapter(rows, dailyRows = []) {
  // Minimal adapter surface that getUsageStats() actually uses:
  //   db.all(sql, params?)
  //   db.get(sql, params?)
  //   db.transaction(fn)   — runs the function eagerly (no real tx needed)
  const handlers = [
    { pattern: /FROM usageHistory ORDER BY id DESC LIMIT 100/i, kind: "recent100" },
    { pattern: /FROM usageHistory WHERE timestamp >= \? AND timestamp <= \?/i, kind: "last10min" },
    { pattern: /FROM usageHistory WHERE timestamp >= \?$/i, kind: "historySince" },
    { pattern: /FROM usageDaily/i, kind: "daily" },
    { pattern: /FROM usageDaily WHERE dateKey >= \?/i, kind: "dailySince" },
  ];
  function dispatch(sql) {
    for (const h of handlers) if (h.pattern.test(sql)) return h.kind;
    return "unknown";
  }
  return {
    driver: "better-sqlite3",
    readOnly: false,
    all: (sql, params) => {
      const k = dispatch(sql);
      if (k === "recent100") return rows;
      if (k === "last10min") return rows.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= new Date(params[0]).getTime() && t <= new Date(params[1]).getTime();
      });
      if (k === "historySince") return rows.filter((r) => r.timestamp >= params[0]);
      if (k === "daily") return dailyRows;
      if (k === "dailySince") return dailyRows.filter((d) => d.dateKey >= params[0]);
      return [];
    },
    get: () => undefined,
    transaction: (fn) => () => fn(),
    run: () => undefined,
    prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }),
    exec: () => undefined,
    close: () => undefined,
    migrate: () => undefined,
    checkpoint: () => undefined,
    backup: () => undefined,
  };
}

function makeRow({
  timestamp,
  provider = "openai",
  model = "gpt-test",
  status = "ok",
  promptTokens = 10,
  completionTokens = 5,
}) {
  return {
    timestamp,
    provider,
    model,
    connectionId: null,
    apiKey: null,
    endpoint: "/v1/chat/completions",
    cost: 0,
    status,
    promptTokens,
    completionTokens,
    tokens: JSON.stringify({
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    }),
  };
}

describe("getUsageStats — bounded success/error status aggregate (RED)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getApiKeys.mockResolvedValue([]);
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getPendingSnapshot.mockResolvedValue({ byModel: {}, byAccount: {} });
    mocks.getRecentEntries.mockResolvedValue([]);
    mocks.getLastErrorProvider.mockResolvedValue("");
  });

  it("RED: 24h bounded window counts ok and error rows in usageHistory.status", async () => {
    // 4 ok + 1 error inside the 24h cutoff → successCount 4, errorCount 1
    const now = Date.now();
    const within = new Date(now - 60 * 60 * 1000).toISOString();
    const rows = [
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "error" }),
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");

    // Bounded aggregate contract after the fix.
    expect(stats.successCount).toBe(4);
    expect(stats.errorCount).toBe(1);
  });

  it("RED: 24h bounded window counts only success when no errors present", async () => {
    const now = Date.now();
    const within = new Date(now - 30 * 60 * 1000).toISOString();
    const rows = [
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");

    expect(stats.successCount).toBe(3);
    expect(stats.errorCount).toBe(0);
  });

  it("RED: 24h bounded window counts only errors when no success present", async () => {
    const now = Date.now();
    const within = new Date(now - 10 * 60 * 1000).toISOString();
    const rows = [
      makeRow({ timestamp: within, status: "error" }),
      makeRow({ timestamp: within, status: "error" }),
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");

    expect(stats.successCount).toBe(0);
    expect(stats.errorCount).toBe(2);
  });

  it("RED: empty usageHistory yields successCount 0 and errorCount 0", async () => {
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter([]));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");

    expect(stats.successCount).toBe(0);
    expect(stats.errorCount).toBe(0);
  });

  it("RED: successCount + errorCount sum to totalRequests for 24h (no double-count)", async () => {
    // For 24h: every row in usageHistory is also counted in byProvider.
    // successCount + errorCount must equal the byProvider sum (no overlap,
    // no missing buckets within the bounded window).
    const now = Date.now();
    const within = new Date(now - 5 * 60 * 1000).toISOString();
    const rows = [
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "error" }),
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");

    expect(stats.successCount + stats.errorCount).toBe(stats.totalRequests);
  });

  // 7d / 30d currently route through the usageDaily summary branch which
  // never sets successCount / errorCount.  The fix must keep 7d/30d on
  // daily aggregates for tokens/requests but additionally derive
  // successCount / errorCount from a bounded usageHistory read with the
  // same UTC cutoff as the period.
  it("RED: 7d bounded window counts ok and error rows from usageHistory (not zero)", async () => {
    // 3 ok + 2 error within 7d window.  No daily data → tokens will be
    // zero, but success/error must still reflect the bounded history.
    const now = Date.now();
    const within = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const rows = [
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "error" }),
      makeRow({ timestamp: within, status: "error" }),
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, []));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("7d");

    // Both must be non-zero; current code returns undefined → coerced to 0.
    expect(stats.successCount).toBe(3);
    expect(stats.errorCount).toBe(2);
  });

  it("RED: 30d bounded window counts ok and error rows from usageHistory (not zero)", async () => {
    // 6 ok + 1 error within 30d window.  Daily summary is intentionally
    // omitted to prove the bounded history read is the source of truth.
    const now = Date.now();
    const within = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(); // 15 days ago
    const rows = [
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "ok" }),
      makeRow({ timestamp: within, status: "error" }),
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, []));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("30d");

    expect(stats.successCount).toBe(6);
    expect(stats.errorCount).toBe(1);
  });

  it("RED: 7d empty history yields successCount 0 and errorCount 0", async () => {
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter([], []));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("7d");

    expect(stats.successCount).toBe(0);
    expect(stats.errorCount).toBe(0);
  });

  it("RED: 30d empty history yields successCount 0 and errorCount 0", async () => {
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter([], []));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("30d");

    expect(stats.successCount).toBe(0);
    expect(stats.errorCount).toBe(0);
  });

  it("RED: 7d no-double-count: successCount + errorCount sum to totalRequests", async () => {
    // Mix of statuses with daily summary present.
    const now = Date.now();
    const within = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      makeRow({ timestamp: within, status: "ok", promptTokens: 100, completionTokens: 50 }),
      makeRow({ timestamp: within, status: "ok", promptTokens: 200, completionTokens: 80 }),
      makeRow({ timestamp: within, status: "error", promptTokens: 50, completionTokens: 0 }),
    ];
    // Synthetic daily row so totalRequests is not zero.
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dailyRows = [
      {
        dateKey,
        data: JSON.stringify({
          requests: 3,
          promptTokens: 350,
          completionTokens: 130,
          byProvider: {
            openai: { requests: 3, promptTokens: 350, completionTokens: 130, cachedTokens: 0, cost: 0 },
          },
          byModel: { "gpt-test|openai": { requests: 3, promptTokens: 350, completionTokens: 130, cachedTokens: 0, cost: 0, rawModel: "gpt-test", provider: "openai" } },
        }),
      },
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, dailyRows));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("7d");

    expect(stats.successCount + stats.errorCount).toBe(stats.totalRequests);
  });

  it("RED: 30d no-double-count: successCount + errorCount sum to totalRequests", async () => {
    const now = Date.now();
    const within = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      makeRow({ timestamp: within, status: "ok", promptTokens: 10, completionTokens: 5 }),
      makeRow({ timestamp: within, status: "error", promptTokens: 8, completionTokens: 2 }),
    ];
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dailyRows = [
      {
        dateKey,
        data: JSON.stringify({
          requests: 2,
          promptTokens: 18,
          completionTokens: 7,
          byProvider: { openai: { requests: 2, promptTokens: 18, completionTokens: 7, cachedTokens: 0, cost: 0 } },
          byModel: { "gpt-test|openai": { requests: 2, promptTokens: 18, completionTokens: 7, cachedTokens: 0, cost: 0, rawModel: "gpt-test", provider: "openai" } },
        }),
      },
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, dailyRows));

    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("30d");

    expect(stats.successCount + stats.errorCount).toBe(stats.totalRequests);
  });

  it("GREEN: multi-day 7d boundary alignment — overlay and daily-summary use same local-midnight cutoff", async () => {
    // 3 days of data, 7d window includes all of them.
    // Each day has 4 rows (3 ok + 1 error).
    // Total across all days: 9 ok + 3 error = 12 requests total.
    const now = Date.now();
    const days = [-6, -4, -2]; // 3 non-consecutive days all within 7d local-midnight window
    const rows = [];
    const dailyRows = [];

    for (const dayOffset of days) {
      const dayStart = new Date(now + dayOffset * 86400000);
      const dateKey = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;
      const ts = dayStart.toISOString();

      rows.push(makeRow({ timestamp: ts, status: "ok", promptTokens: 100, completionTokens: 50 }));
      rows.push(makeRow({ timestamp: ts, status: "ok", promptTokens: 100, completionTokens: 50 }));
      rows.push(makeRow({ timestamp: ts, status: "ok", promptTokens: 100, completionTokens: 50 }));
      rows.push(makeRow({ timestamp: ts, status: "error", promptTokens: 10, completionTokens: 0 }));

      dailyRows.push({
        dateKey,
        data: JSON.stringify({
          requests: 4,
          promptTokens: 310,
          completionTokens: 150,
          byProvider: { openai: { requests: 4, promptTokens: 310, completionTokens: 150, cachedTokens: 0, cost: 0 } },
          byModel: { "gpt-test|openai": { requests: 4, promptTokens: 310, completionTokens: 150, cachedTokens: 0, cost: 0, rawModel: "gpt-test", provider: "openai" } },
        }),
      });
    }

    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, dailyRows));
    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("7d");

    // Each of 3 days: 3 ok + 1 error = 4 rows per day.  3 days = 9 ok + 3 error = 12 total.
    expect(stats.successCount).toBe(9);
    expect(stats.errorCount).toBe(3);
    expect(stats.successCount + stats.errorCount).toBe(stats.totalRequests);
    expect(stats.totalRequests).toBe(12);
  });

  it("GREEN: 7d no-double-count holds when overlay and daily-summary sets overlap but are not identical rows (different breakdowns per field)", async () => {
    // Daily summary says 6 requests across 2 days; overlay sees 6 history rows.
    // Each day has a mix of ok/error.  Invariant must hold.
    const now = Date.now();
    const dayA = new Date(now - 2 * 86400000).toISOString();
    const dayB = new Date(now - 4 * 86400000).toISOString();
    const rows = [
      makeRow({ timestamp: dayA, status: "ok", promptTokens: 100, completionTokens: 50 }),
      makeRow({ timestamp: dayA, status: "ok", promptTokens: 100, completionTokens: 50 }),
      makeRow({ timestamp: dayA, status: "error", promptTokens: 10, completionTokens: 0 }),
      makeRow({ timestamp: dayB, status: "ok", promptTokens: 200, completionTokens: 100 }),
      makeRow({ timestamp: dayB, status: "ok", promptTokens: 200, completionTokens: 100 }),
      makeRow({ timestamp: dayB, status: "ok", promptTokens: 200, completionTokens: 100 }),
    ];

    const dateKeyA = dayA.slice(0, 10);
    const dateKeyB = dayB.slice(0, 10);
    const dailyRows = [
      {
        dateKey: dateKeyA,
        data: JSON.stringify({
          requests: 3,
          promptTokens: 210,
          completionTokens: 100,
          byProvider: { openai: { requests: 3, promptTokens: 210, completionTokens: 100, cachedTokens: 0, cost: 0 } },
          byModel: { "gpt-test|openai": { requests: 3, promptTokens: 210, completionTokens: 100, cachedTokens: 0, cost: 0, rawModel: "gpt-test", provider: "openai" } },
        }),
      },
      {
        dateKey: dateKeyB,
        data: JSON.stringify({
          requests: 3,
          promptTokens: 600,
          completionTokens: 300,
          byProvider: { openai: { requests: 3, promptTokens: 600, completionTokens: 300, cachedTokens: 0, cost: 0 } },
          byModel: { "gpt-test|openai": { requests: 3, promptTokens: 600, completionTokens: 300, cachedTokens: 0, cost: 0, rawModel: "gpt-test", provider: "openai" } },
        }),
      },
    ];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, dailyRows));
    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("7d");

    expect(stats.successCount).toBe(5);
    expect(stats.errorCount).toBe(1);
    expect(stats.successCount + stats.errorCount).toBe(stats.totalRequests);
  });

  it("GREEN: 7d — rows timestamped at the exact midnight boundary are counted consistently", async () => {
    // The local-midnight cutoff is the boundary.  Rows at the exact boundary
    // must be included in both daily-summary and overlay counts.
    const now = new Date();
    const midnightBoundary = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 + 1);
    const atBoundary = midnightBoundary.toISOString();
    const dateKeyAtBoundary = `${midnightBoundary.getFullYear()}-${String(midnightBoundary.getMonth() + 1).padStart(2, "0")}-${String(midnightBoundary.getDate()).padStart(2, "0")}`;

    const rows = [
      makeRow({ timestamp: atBoundary, status: "ok", promptTokens: 100, completionTokens: 50 }),
      makeRow({ timestamp: atBoundary, status: "error", promptTokens: 10, completionTokens: 0 }),
    ];
    const dailyRows = [{
      dateKey: dateKeyAtBoundary,
      data: JSON.stringify({
        requests: 2,
        promptTokens: 110,
        completionTokens: 50,
        byProvider: { openai: { requests: 2, promptTokens: 110, completionTokens: 50, cachedTokens: 0, cost: 0 } },
        byModel: { "gpt-test|openai": { requests: 2, promptTokens: 110, completionTokens: 50, cachedTokens: 0, cost: 0, rawModel: "gpt-test", provider: "openai" } },
      }),
    }];
    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, dailyRows));
    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("7d");

    expect(stats.successCount).toBe(1);
    expect(stats.errorCount).toBe(1);
    expect(stats.successCount + stats.errorCount).toBe(stats.totalRequests);
  });

  it("GREEN: 30d — successCount + errorCount === totalRequests across 4 weeks", async () => {
    // 4 weeks of daily data, 3 rows per day.
    const now = Date.now();
    const rows = [];
    const dailyRows = [];

    for (let day = -25; day <= 0; day++) {
      const dayDate = new Date(now + day * 86400000);
      const ts = dayDate.toISOString();
      const dateKey = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;

      rows.push(makeRow({ timestamp: ts, status: "ok", promptTokens: 100, completionTokens: 50 }));
      rows.push(makeRow({ timestamp: ts, status: "ok", promptTokens: 100, completionTokens: 50 }));
      rows.push(makeRow({ timestamp: ts, status: "error", promptTokens: 10, completionTokens: 0 }));

      dailyRows.push({
        dateKey,
        data: JSON.stringify({
          requests: 3,
          promptTokens: 210,
          completionTokens: 100,
          byProvider: { openai: { requests: 3, promptTokens: 210, completionTokens: 100, cachedTokens: 0, cost: 0 } },
          byModel: { "gpt-test|openai": { requests: 3, promptTokens: 210, completionTokens: 100, cachedTokens: 0, cost: 0, rawModel: "gpt-test", provider: "openai" } },
        }),
      });
    }

    mocks.getAdapter.mockResolvedValue(buildFakeAdapter(rows, dailyRows));
    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("30d");

    // 26 days × 3 rows/day = 78 total; 26×2=52 ok + 26×1=26 error
    expect(stats.successCount).toBe(52);
    expect(stats.errorCount).toBe(26);
    expect(stats.successCount + stats.errorCount).toBe(stats.totalRequests);
  });
});
