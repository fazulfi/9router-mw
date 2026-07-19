import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { saveRequestDetailMock } = vi.hoisted(() => ({
  saveRequestDetailMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: saveRequestDetailMock,
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { buildRequestDetail } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

const CORRELATION_ID = "019f7fa1-0d8d-7000-8000-000000000000";
const ATTEMPT_ID = "019f7fa1-0d8d-7000-8000-000000000001";
let monotonicNow;

function requestTiming(phases = {}) {
  return { requestStartedAt: 900, attemptStartedAt: 950, phases };
}

function responseLogger() {
  return { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() };
}

beforeEach(() => {
  saveRequestDetailMock.mockClear();
  monotonicNow = 1_000;
  vi.spyOn(globalThis.performance, "now").mockImplementation(() => monotonicNow);
});

afterEach(() => vi.restoreAllMocks());

describe("request correlation and terminal timing", () => {
  it("preserves request-wide correlation and explicit attempt id in detail records", () => {
    const detail = buildRequestDetail({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
    });

    expect(detail).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
    });
  });

  it("uses headers for stream response duration and keeps attempt/request totals distinct", () => {
    monotonicNow = 1_100;
    const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
      requestId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
      requestTiming: requestTiming({ ingress_ms: 3, upstream_headers_ms: 20 }),
      responseStartTime: 1_000,
      body: {},
      translatedBody: {},
    });

    onStreamComplete({ content: "OK" }, { input_tokens: 1, output_tokens: 1 }, 1_050);

    expect(streamDetailId).toBe(ATTEMPT_ID);
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      latency: {
        ttft: 150,
        total: 150,
        request_total: 200,
        phases: { ingress_ms: 3, upstream_headers_ms: 20, response_ms: 100 },
      },
    });
  });

  it("persists sanitized phases for non-streaming success", async () => {
    await handleNonStreamingResponse({
      requestId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      providerResponse: new Response(JSON.stringify({
        id: "chatcmpl-test",
        model: "test-model",
        choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { headers: { "content-type": "application/json" } }),
      provider: "github",
      model: "test-model",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { messages: [] },
      stream: false,
      translatedBody: {},
      requestTiming: requestTiming({
        ingress_ms: 3,
        upstream_headers_ms: 20,
        auth_total_ms: Number.NaN,
        dynamic_model_ms: 500,
      }),
      responseStartTime: 975,
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      reqLogger: responseLogger(),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      latency: {
        ttft: 100,
        total: 50,
        request_total: 100,
        phases: { ingress_ms: 3, upstream_headers_ms: 20, response_ms: 25 },
      },
    });
  });

  it("persists a terminal detail when non-stream JSON parsing fails", async () => {
    const result = await handleNonStreamingResponse({
      requestId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      providerResponse: new Response("not-json", { headers: { "content-type": "application/json" } }),
      provider: "github",
      model: "test-model",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { messages: [] },
      stream: false,
      translatedBody: {},
      requestTiming: requestTiming({ upstream_headers_ms: 20 }),
      responseStartTime: 975,
      reqLogger: responseLogger(),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      status: "error",
      response: { error: "Invalid JSON response from github", status: 502 },
      latency: { phases: { upstream_headers_ms: 20, response_ms: 25 } },
    });
  });

  it("persists request identity and phases for forced SSE-to-JSON success", async () => {
    const chunk = {
      id: "chatcmpl-test",
      model: "test-model",
      choices: [{ delta: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    await handleForcedSSEToJson({
      requestId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      providerResponse: new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
      sourceFormat: FORMATS.OPENAI,
      provider: "github",
      model: "test-model",
      body: { messages: [] },
      stream: true,
      translatedBody: {},
      requestTiming: requestTiming({ compression_ms: 4 }),
      responseStartTime: 1_000,
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      latency: { phases: { compression_ms: 4, response_ms: 0 } },
    });
  });

  it("persists a terminal detail when forced SSE conversion throws", async () => {
    const result = await handleForcedSSEToJson({
      requestId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      providerResponse: {
        headers: new Headers({ "content-type": "text/event-stream" }),
        text: vi.fn().mockRejectedValue(new Error("stream read failed")),
      },
      sourceFormat: FORMATS.OPENAI,
      provider: "github",
      model: "test-model",
      body: { messages: [] },
      stream: true,
      translatedBody: {},
      requestTiming: requestTiming({ upstream_headers_ms: 8 }),
      responseStartTime: 980,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      status: "error",
      latency: { phases: { upstream_headers_ms: 8, response_ms: 20 } },
    });
  });

  it("updates the same stream detail on abort", () => {
    monotonicNow = 1_100;
    const { onStreamError } = buildOnStreamComplete({
      requestId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      provider: "github",
      model: "test-model",
      requestTiming: requestTiming({ upstream_headers_ms: 10 }),
      responseStartTime: 1_000,
      body: {},
      translatedBody: {},
    });

    onStreamError(new DOMException("aborted", "AbortError"));

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      status: "error",
      response: { error: "Stream aborted", status: 499 },
      latency: { phases: { upstream_headers_ms: 10, response_ms: 100 } },
    });
  });

  it("persists terminal stream detail when upstream is not SSE", async () => {
    monotonicNow = 1_025;
    const terminal = buildOnStreamComplete({
      requestId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      provider: "github",
      model: "test-model",
      requestTiming: requestTiming({ upstream_headers_ms: 10 }),
      responseStartTime: 1_000,
      body: {},
      translatedBody: {},
    });
    const streamController = { signal: undefined, handleError: vi.fn() };

    const result = await handleStreamingResponse({
      providerResponse: new Response("<title>Bad Gateway</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      provider: "github",
      model: "test-model",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { messages: [] },
      stream: true,
      translatedBody: {},
      requestTiming: requestTiming({ upstream_headers_ms: 10 }),
      responseStartTime: 1_000,
      connectionId: "test-connection",
      reqLogger: {},
      streamController,
      ...terminal,
    });

    expect(result.success).toBe(false);
    expect(streamController.handleError).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      status: "error",
      latency: { phases: { upstream_headers_ms: 10, response_ms: 25 } },
    });
  });

  it("persists in-progress stream identity without inventing response duration", async () => {
    await handleStreamingResponse({
      providerResponse: new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
      provider: "github",
      model: "test-model",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      userAgent: "test",
      body: { messages: [] },
      stream: true,
      translatedBody: {},
      requestTiming: requestTiming({ request_before_dispatch_total_ms: 8, upstream_headers_ms: 5 }),
      responseStartTime: 1_000,
      connectionId: "test-connection",
      reqLogger: {},
      streamController: { signal: undefined, handleError: vi.fn() },
      onStreamComplete: vi.fn(),
      onStreamError: vi.fn(),
      streamDetailId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: ATTEMPT_ID,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      latency: {
        total: 50,
        request_total: 100,
        phases: { request_before_dispatch_total_ms: 8, upstream_headers_ms: 5 },
      },
    });
    expect(saveRequestDetailMock.mock.calls[0][0].latency.phases)
      .not.toHaveProperty("response_ms");
  });

  it("notifies terminal persistence callback for AbortError", () => {
    const onError = vi.fn();
    const controller = createStreamController({
      onError,
      provider: "github",
      model: "test-model",
      log: { line: vi.fn(), errorLine: vi.fn() },
    });

    controller.handleError(new DOMException("aborted", "AbortError"));

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
