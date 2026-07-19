// Guards forceStream moved from chatCore hardcode → PROVIDERS schema (#5).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, parseUpstreamErrorMock, refreshWithRetryMock, saveRequestDetailMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  parseUpstreamErrorMock: vi.fn(),
  refreshWithRetryMock: vi.fn(),
  saveRequestDetailMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: refreshWithRetryMock,
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/translator/formats/claude.js", () => ({
  normalizeClaudePassthrough: vi.fn(),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({
  injectCaveman: vi.fn(),
}));

vi.mock("../../open-sse/rtk/ponytail.js", () => ({
  injectPonytail: vi.fn(),
}));

vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
}));

vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: parseUpstreamErrorMock,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: saveRequestDetailMock,
}));

const FORCED = ["openai", "codex", "commandcode"];

function makeOptions(bodyStream) {
  const body = {
    model: "gpt-4.1",
    messages: [{ role: "user", content: "hello" }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  return {
    body,
    modelInfo: { provider: "openai", model: "gpt-4.1" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("forceStream provider config", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
    parseUpstreamErrorMock.mockReset();
    parseUpstreamErrorMock.mockResolvedValue({ statusCode: 400, message: "bad request" });
    refreshWithRetryMock.mockReset();
    saveRequestDetailMock.mockClear();
  });

  it("only openai/codex/commandcode force streaming", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    for (const id of FORCED) {
      expect(PROVIDERS[id]?.forceStream, `${id} forced`).toBe(true);
    }
    // a sample of others must NOT force
    for (const id of ["deepseek", "claude", "gemini", "openrouter"]) {
      expect(PROVIDERS[id]?.forceStream, `${id} not forced`).not.toBe(true);
    }
  });

  it.each([undefined, false])( "keeps forced-stream providers streaming for JSON clients when body.stream is %s", async (bodyStream) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(bodyStream));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
    expect(executeMock.mock.calls[0][0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  });

  it("uses executor request id for executor-error details", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(false));

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0].id)
      .toBe(executeMock.mock.calls[0][0].requestId);
  });

  it("uses executor request id for upstream-error details", async () => {
    executeMock.mockResolvedValueOnce({
      response: new Response("bad request", { status: 400 }),
      url: "https://provider.test/v1/responses",
      headers: {},
      transformedBody: {},
    });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(false));

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0].id)
      .toBe(executeMock.mock.calls[0][0].requestId);
  });

  it("reuses request id after token refresh", async () => {
    executeMock.mockResolvedValue({
      response: new Response("unauthorized", { status: 401 }),
      url: "https://provider.test/v1/responses",
      headers: {},
      transformedBody: {},
    });
    refreshWithRetryMock.mockResolvedValueOnce({ accessToken: "refreshed" });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(false));

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[1][0].requestId)
      .toBe(executeMock.mock.calls[0][0].requestId);
  });
});
