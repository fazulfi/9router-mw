// Guards forceStream moved from chatCore hardcode → PROVIDERS schema (#5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  parseUpstreamErrorMock,
  refreshWithRetryMock,
  saveRequestDetailMock,
  prefetchRemoteImagesMock,
  compressWithHeadroomMock,
  translateRequestMock,
  needsTranslationMock,
  handleStreamingResponseMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  parseUpstreamErrorMock: vi.fn(),
  refreshWithRetryMock: vi.fn(),
  saveRequestDetailMock: vi.fn(() => Promise.resolve()),
  prefetchRemoteImagesMock: vi.fn(),
  compressWithHeadroomMock: vi.fn(),
  translateRequestMock: vi.fn(),
  needsTranslationMock: vi.fn(),
  handleStreamingResponseMock: vi.fn(),
}));

vi.mock("../../open-sse/translator/index.js", () => ({
  initState: vi.fn(() => ({})),
  needsTranslation: needsTranslationMock,
  register: vi.fn(),
  translateRequest: translateRequestMock,
  translateResponse: vi.fn(() => []),
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
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => ({
    onStreamComplete: vi.fn(),
    onStreamError: vi.fn(),
    streamDetailId: "stream-detail-id",
  })),
  handleStreamingResponse: handleStreamingResponseMock,
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
  compressWithHeadroom: compressWithHeadroomMock,
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
  prefetchRemoteImages: prefetchRemoteImagesMock,
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn(() => ({ prompt_tokens: 0, completion_tokens: 0 })),
  saveUsageStats: vi.fn(),
  formatDoneLine: vi.fn(() => ""),
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
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORRELATION_ID = "019f7fa1-0d8d-4000-8000-000000000001";
const ATTEMPT_ID = "019f7fa1-0d8d-4000-8000-000000000002";
let monotonicNow;

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
    prefetchRemoteImagesMock.mockReset();
    prefetchRemoteImagesMock.mockResolvedValue(0);
    compressWithHeadroomMock.mockReset();
    compressWithHeadroomMock.mockResolvedValue(null);
    translateRequestMock.mockReset();
    translateRequestMock.mockImplementation((_source, _target, _model, body) => ({ ...body }));
    needsTranslationMock.mockReset();
    needsTranslationMock.mockReturnValue(false);
    handleStreamingResponseMock.mockReset();
    handleStreamingResponseMock.mockImplementation((options) => ({ success: true, options }));
    monotonicNow = 1_000;
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => monotonicNow);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    expect(executeMock.mock.calls[0][0].requestId).toMatch(UUID_V4_RE);
  });

  it("returns a successful non-streaming response when the executor reports its response format", async () => {
    const responseBody = {
      id: "chatcmpl-provider-format",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    };
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      url: "https://provider.test/v1/chat/completions",
      headers: {},
      transformedBody: {},
      responseFormat: "openai",
    });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    const result = await handleChatCore({
      ...makeOptions(false),
      modelInfo: { provider: "openrouter", model: "gpt-4.1" },
    });

    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject(responseBody);
  });

  it("passes the executor response format to the streaming handler", async () => {
    executeMock.mockResolvedValueOnce({
      response: new Response("stream", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
      url: "https://provider.test/v1/chat/completions",
      headers: {},
      transformedBody: {},
      responseFormat: "claude",
    });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    const result = await handleChatCore({
      ...makeOptions(true),
      modelInfo: { provider: "openrouter", model: "gpt-4.1" },
    });

    expect(result.success).toBe(true);
    expect(handleStreamingResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetFormat: "claude" }),
    );
  });

  it("uses the retry executor response format after token refresh", async () => {
    const claudeBody = {
      id: "msg-retry",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "recovered" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    executeMock
      .mockResolvedValueOnce({
        response: new Response("unauthorized", { status: 401 }),
        url: "https://provider.test/v1/chat/completions",
        headers: {},
        transformedBody: {},
        responseFormat: "openai",
      })
      .mockResolvedValueOnce({
        response: new Response(JSON.stringify(claudeBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        url: "https://provider.test/v1/messages",
        headers: {},
        transformedBody: {},
        responseFormat: "claude",
      });
    refreshWithRetryMock.mockResolvedValueOnce({ accessToken: "refreshed" });
    needsTranslationMock.mockReturnValue(true);
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    const result = await handleChatCore({
      ...makeOptions(false),
      modelInfo: { provider: "openrouter", model: "gpt-4.1" },
    });
    const responseBody = await result.response.json();

    expect(result.success).toBe(true);
    expect(responseBody.choices[0].message.content).toBe("recovered");
  });

  it("creates distinct request ids for concurrent provider attempts", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await Promise.all([
      handleChatCore(makeOptions(false)),
      handleChatCore(makeOptions(false)),
    ]);

    const requestIds = executeMock.mock.calls.map(([options]) => options.requestId);
    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(2);
    expect(requestIds.every((requestId) => UUID_V4_RE.test(requestId))).toBe(true);
  });

  it("uses Worker-compatible global Web Crypto for request ids", async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce(CORRELATION_ID)
      .mockReturnValueOnce(ATTEMPT_ID);
    vi.stubGlobal("crypto", { randomUUID });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    try {
      await handleChatCore(makeOptions(false));
      expect(randomUUID).toHaveBeenCalledTimes(2);
      expect(executeMock.mock.calls[0][0].requestId)
        .toBe(ATTEMPT_ID);
      expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
        id: ATTEMPT_ID,
        attemptId: ATTEMPT_ID,
        correlationId: CORRELATION_ID,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses executor request id for executor-error details", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore({ ...makeOptions(false), correlationId: CORRELATION_ID, attemptId: ATTEMPT_ID });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(executeMock.mock.calls[0][0].requestId).toBe(ATTEMPT_ID);
  });

  it("uses executor request id for upstream-error details", async () => {
    executeMock.mockResolvedValueOnce({
      response: new Response("bad request", { status: 400 }),
      url: "https://provider.test/v1/responses",
      headers: {},
      transformedBody: {},
    });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore({ ...makeOptions(false), correlationId: CORRELATION_ID, attemptId: ATTEMPT_ID });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(executeMock.mock.calls[0][0].requestId).toBe(ATTEMPT_ID);
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

  it("records attempt work and omits response time when execution fails before headers", async () => {
    prefetchRemoteImagesMock.mockImplementationOnce(async () => {
      monotonicNow += 7;
      return 0;
    });
    compressWithHeadroomMock.mockImplementationOnce(async () => {
      monotonicNow += 11;
      return null;
    });
    executeMock.mockImplementationOnce(async () => {
      monotonicNow += 13;
      throw new Error("boom");
    });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore({
      ...makeOptions(false),
      correlationId: CORRELATION_ID,
      attemptId: ATTEMPT_ID,
      requestTiming: { requestStartedAt: 900, attemptStartedAt: 950, phases: { ingress_ms: 5 } },
    });

    const latency = saveRequestDetailMock.mock.calls[0][0].latency;
    const phases = latency.phases;
    expect(phases).toEqual({
      ingress_ms: 5,
      translation_ms: 7,
      compression_ms: 11,
      request_before_dispatch_total_ms: 118,
      upstream_headers_ms: 13,
    });
    expect(phases).not.toHaveProperty("response_ms");
    expect(phases).not.toHaveProperty("local_before_dispatch_ms");
    expect(latency.total).toBe(81);
    expect(latency.request_total).toBe(131);
  });

  it("accumulates upstream header timing across a token-refresh retry", async () => {
    executeMock
      .mockImplementationOnce(async () => {
        monotonicNow += 10;
        return {
          response: new Response("unauthorized", { status: 401 }),
          url: "https://provider.test/v1/responses",
          headers: {},
          transformedBody: {},
        };
      })
      .mockImplementationOnce(async () => {
        monotonicNow += 20;
        return {
          response: new Response("still unauthorized", { status: 401 }),
          url: "https://provider.test/v1/responses",
          headers: {},
          transformedBody: {},
        };
      });
    refreshWithRetryMock.mockImplementationOnce(async () => {
      monotonicNow += 5;
      return { accessToken: "refreshed" };
    });
    parseUpstreamErrorMock.mockImplementationOnce(async () => {
      monotonicNow += 7;
      return { statusCode: 401, message: "unauthorized" };
    });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore({
      ...makeOptions(false),
      correlationId: CORRELATION_ID,
      attemptId: ATTEMPT_ID,
      requestTiming: { requestStartedAt: 800, attemptStartedAt: 900, phases: {} },
    });

    const latency = saveRequestDetailMock.mock.calls[0][0].latency;
    const phases = latency.phases;
    expect(phases.upstream_headers_ms).toBe(30);
    expect(phases.auth_total_ms).toBe(5);
    expect(phases.response_ms).toBe(7);
    expect(latency.total).toBe(142);
    expect(latency.request_total).toBe(242);
  });

  it("persists a terminal attempt detail when translation throws synchronously", async () => {
    translateRequestMock.mockImplementationOnce(() => { throw new Error("translator exploded"); });
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await expect(handleChatCore({
      ...makeOptions(false),
      correlationId: CORRELATION_ID,
      attemptId: ATTEMPT_ID,
      requestTiming: { requestStartedAt: 900, attemptStartedAt: 950, phases: {} },
    })).rejects.toThrow("translator exploded");

    expect(executeMock).not.toHaveBeenCalled();
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      status: "error",
      response: { error: "Request translation failed", status: 500 },
    });
    expect(saveRequestDetailMock.mock.calls[0][0].latency.phases)
      .toHaveProperty("translation_ms");
  });

  it("persists a terminal attempt detail when translation returns no body", async () => {
    translateRequestMock.mockReturnValueOnce(null);
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    const result = await handleChatCore({
      ...makeOptions(false),
      correlationId: CORRELATION_ID,
      attemptId: ATTEMPT_ID,
      requestTiming: { requestStartedAt: 900, attemptStartedAt: 950, phases: {} },
    });

    expect(result.success).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      status: "error",
      response: { error: "Request translation failed", status: 400 },
    });
  });
});
