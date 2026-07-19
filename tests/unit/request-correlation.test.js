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

const REQUEST_ID = "019f7fa1-0d8d-7000-8000-000000000001";

beforeEach(() => saveRequestDetailMock.mockClear());
afterEach(() => vi.useRealTimers());

describe("request correlation", () => {
  it("preserves request id in request detail records", () => {
    const detail = buildRequestDetail({
      id: REQUEST_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
    });

    expect(detail.id).toBe(REQUEST_ID);
  });

  it("uses request id for streaming detail updates", () => {
    const result = buildOnStreamComplete({
      requestId: REQUEST_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
      requestStartTime: Date.now(),
      body: {},
      translatedBody: {},
    });

    expect(result.streamDetailId).toBe(REQUEST_ID);
  });

  it("uses request id for streaming completion persistence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_100);
    const { onStreamComplete } = buildOnStreamComplete({
      requestId: REQUEST_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
      requestStartTime: 900,
      responseStartTime: 1_000,
      requestPhases: { ingress_ms: 3, upstream_headers_ms: 20 },
      body: {},
      translatedBody: {},
    });

    onStreamComplete({ content: "OK" }, { input_tokens: 1, output_tokens: 1 }, 1_050);

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0].id).toBe(REQUEST_ID);
    expect(saveRequestDetailMock.mock.calls[0][0].latency).toEqual({
      ttft: 150,
      total: 200,
      phases: { ingress_ms: 3, upstream_headers_ms: 20, response_ms: 50 },
    });
  });

  it("uses request id for non-streaming persistence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    await handleNonStreamingResponse({
      requestId: REQUEST_ID,
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
      requestStartTime: 900,
      responseStartTime: 975,
      requestPhases: {
        ingress_ms: 3,
        upstream_headers_ms: 20,
        auth_ms: Number.NaN,
        dynamic_model_ms: 500,
      },
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0].id).toBe(REQUEST_ID);
    expect(saveRequestDetailMock.mock.calls[0][0].latency.phases).toEqual({
      ingress_ms: 3,
      upstream_headers_ms: 20,
      response_ms: 25,
    });
  });

  it("uses request id for forced SSE-to-JSON persistence", async () => {
    const chunk = {
      id: "chatcmpl-test",
      model: "test-model",
      choices: [{ delta: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    await handleForcedSSEToJson({
      requestId: REQUEST_ID,
      providerResponse: new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
      sourceFormat: FORMATS.OPENAI,
      provider: "github",
      model: "test-model",
      body: { messages: [] },
      stream: true,
      translatedBody: {},
      requestStartTime: Date.now(),
      responseStartTime: Date.now(),
      requestPhases: { compression_ms: 4 },
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0].id).toBe(REQUEST_ID);
    expect(saveRequestDetailMock.mock.calls[0][0].latency.phases)
      .toEqual({ compression_ms: 4, response_ms: expect.any(Number) });
  });

  it("uses request id for streaming in-progress persistence", async () => {
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
      requestStartTime: Date.now(),
      responseStartTime: Date.now(),
      requestPhases: { local_before_dispatch_ms: 8, upstream_headers_ms: 5 },
      connectionId: "test-connection",
      reqLogger: {},
      streamController: { signal: undefined, handleError: vi.fn() },
      onStreamComplete: vi.fn(),
      streamDetailId: REQUEST_ID,
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0].id).toBe(REQUEST_ID);
    expect(saveRequestDetailMock.mock.calls[0][0].latency.phases).toEqual({
      local_before_dispatch_ms: 8,
      upstream_headers_ms: 5,
    });
    expect(saveRequestDetailMock.mock.calls[0][0].latency.phases)
      .not.toHaveProperty("response_ms");
  });
});
