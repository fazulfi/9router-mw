import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  isValidApiKey: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
  getProjectIdForConnection: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: vi.fn(() => null),
  getProviderCredentials: mocks.getProviderCredentials,
  isValidApiKey: mocks.isValidApiKey,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://headroom.test" }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn(async () => null) }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn() }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: vi.fn((status, message) => new Response(message, { status })),
  unavailableResponse: vi.fn((status, message) => new Response(message, { status })),
}));
vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    SERVICE_UNAVAILABLE: 503,
  },
}));
vi.mock("open-sse/translator/formats.js", () => ({ detectFormatByEndpoint: vi.fn(() => "openai") }));
vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), maskKey: vi.fn(() => "masked"),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));
vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: mocks.getProjectIdForConnection,
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function advance(ms, value) {
  return async (...args) => {
    vi.setSystemTime(Date.now() + ms);
    return typeof value === "function" ? value(...args) : value;
  };
}

function makeRequest(body, jsonDelay = 0) {
  return {
    url: "https://router.test/v1/chat/completions",
    headers: new Headers({ "content-type": "application/json" }),
    json: advance(jsonDelay, body),
  };
}

describe("chat request phase timing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "github", model: "gpt-test" });
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "connection-a",
      connectionName: "Account A",
      providerSpecificData: {},
    });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    mocks.handleChatCore.mockResolvedValue({ success: true, response: Response.json({ ok: true }) });
  });

  afterEach(() => vi.useRealTimers());

  it("propagates auth and routing timings with overlapping diagnostic DB timing", async () => {
    mocks.getSettings
      .mockImplementationOnce(advance(7, { requireApiKey: false }))
      .mockImplementationOnce(advance(23, {}));
    mocks.getComboModels.mockImplementationOnce(advance(11, null));
    mocks.getModelInfo.mockImplementationOnce(advance(13, { provider: "github", model: "gpt-test" }));
    mocks.getProviderCredentials.mockImplementationOnce(advance(17, {
      connectionId: "connection-a",
      connectionName: "Account A",
      providerSpecificData: {},
    }));
    mocks.checkAndRefreshToken.mockImplementationOnce(advance(19, (_provider, credentials) => credentials));

    await handleChat(makeRequest({ model: "github/gpt-test", messages: [] }, 5));

    const { requestTiming } = mocks.handleChatCore.mock.calls[0][0];
    expect(requestTiming).toEqual({
      startedAt: 1_000,
      phases: {
        ingress_ms: 5,
        auth_ms: 26,
        routing_ms: 41,
        db_ms: 71,
      },
    });
  });

  it("clones pre-attempt timings so fallback does not inherit prior attempt work", async () => {
    mocks.getProviderCredentials
      .mockResolvedValueOnce({ connectionId: "connection-a", connectionName: "Account A", providerSpecificData: {} })
      .mockResolvedValueOnce({ connectionId: "connection-b", connectionName: "Account B", providerSpecificData: {} });
    mocks.handleChatCore
      .mockImplementationOnce(async ({ requestTiming }) => {
        if (requestTiming) {
          requestTiming.phases.translation_ms = 31;
          requestTiming.phases.upstream_headers_ms = 47;
        }
        vi.setSystemTime(Date.now() + 50);
        return { success: false, status: 429, error: "rate limited", response: new Response("rate", { status: 429 }) };
      })
      .mockResolvedValueOnce({ success: true, response: Response.json({ ok: true }) });
    mocks.markAccountUnavailable.mockImplementationOnce(advance(7, { shouldFallback: true }));

    const response = await handleChat(makeRequest({ model: "github/gpt-test", messages: [] }));

    expect(response.status).toBe(200);
    const firstTiming = mocks.handleChatCore.mock.calls[0][0].requestTiming;
    const secondTiming = mocks.handleChatCore.mock.calls[1][0].requestTiming;
    expect(secondTiming).not.toBe(firstTiming);
    expect(secondTiming.startedAt).toBe(firstTiming.startedAt);
    expect(secondTiming.phases).not.toHaveProperty("translation_ms");
    expect(secondTiming.phases).not.toHaveProperty("upstream_headers_ms");
  });
});
