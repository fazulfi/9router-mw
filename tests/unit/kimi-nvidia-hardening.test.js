import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock proxyAwareFetch so handleChatCore end-to-end tests never hit the network.
// proxyAwareFetch captures globalThis.fetch at module-load time, so spying on
// global.fetch after import does nothing; module-level mock is required.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { isNvidiaKimiStreamCoerce, handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { buildCoercedSSEResponse } from "../../open-sse/handlers/chatCore/coercedSseHandler.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

// ── isNvidiaKimiStreamCoerce ─────────────────────────────────────────────

describe("isNvidiaKimiStreamCoerce", () => {
  it("returns true for nvidia + kimi-k2.6", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", "kimi-k2.6")).toBe(true);
  });

  it("returns true for nvidia + kimi-k2.7", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", "kimi-k2.7")).toBe(true);
  });

  it("returns true for nvidia + moonshotai/kimi-k2.6", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", "moonshotai/kimi-k2.6")).toBe(true);
  });

  it("returns true for nvidia + moonshotai/kimi-k2.7", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", "moonshotai/kimi-k2.7")).toBe(true);
  });

  it("is case-insensitive for model name", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", "KIMI-K2.6")).toBe(true);
    expect(isNvidiaKimiStreamCoerce("nvidia", "Kimi-K2.7")).toBe(true);
  });

  it("returns false for nvidia + non-Kimi models", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", "llama-3.1-8b")).toBe(false);
    expect(isNvidiaKimiStreamCoerce("nvidia", "meta/llama-3.1-8b-instruct")).toBe(false);
  });

  it("returns false for non-nvidia providers with Kimi models", () => {
    expect(isNvidiaKimiStreamCoerce("github", "kimi-k2.6")).toBe(false);
    expect(isNvidiaKimiStreamCoerce("kimchi", "kimi-k2.6")).toBe(false);
  });

  it("returns false when model is missing", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", undefined)).toBe(false);
    expect(isNvidiaKimiStreamCoerce("nvidia", null)).toBe(false);
    expect(isNvidiaKimiStreamCoerce("nvidia", "")).toBe(false);
  });

  it("returns false for wrong kimi versions", () => {
    expect(isNvidiaKimiStreamCoerce("nvidia", "kimi-k2.5")).toBe(false);
    expect(isNvidiaKimiStreamCoerce("nvidia", "kimi-k2.8")).toBe(false);
    expect(isNvidiaKimiStreamCoerce("nvidia", "kimi-k1.5")).toBe(false);
  });
});

// ── buildCoercedSSEResponse ──────────────────────────────────────────────

async function drainSSE(response) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("buildCoercedSSEResponse", () => {
  it("returns SSE for a content completion", async () => {
    const json = {
      id: "test-id",
      created: 1700000000,
      model: "moonshotai/kimi-k2.6",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello world" },
          finish_reason: "stop",
        },
      ],
    };

    const response = buildCoercedSSEResponse(json);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await drainSSE(response);
    const lines = text.split("\n").filter(Boolean);

    expect(lines.some((l) => l.includes('"Hello world"'))).toBe(true);
    expect(lines.some((l) => l.includes('"finish_reason":"stop"'))).toBe(true);
    expect(lines.some((l) => l === "data: [DONE]")).toBe(true);
  });

  it("includes reasoning_content when present", async () => {
    const json = {
      id: "r-id",
      created: 1700000001,
      model: "kimi-k2.6",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            reasoning_content: "Let me think...",
            content: "Answer: 42",
          },
          finish_reason: "stop",
        },
      ],
    };

    const text = await drainSSE(buildCoercedSSEResponse(json));
    expect(text).toContain("Let me think...");
    expect(text).toContain("Answer: 42");
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("data: [DONE]");
  });

  it("returns SSE for a tool_calls completion", async () => {
    const json = {
      id: "tool-id",
      created: 1700000002,
      model: "kimi-k2.6",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "bash", arguments: '{"cmd":"ls"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const text = await drainSSE(buildCoercedSSEResponse(json));
    expect(text).toContain('"tool_calls"');
    expect(text).toContain('"bash"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text).toContain("data: [DONE]");
  });

  it("includes usage in the finish chunk when provided", async () => {
    const json = {
      id: "usage-id",
      created: 1700000003,
      model: "kimi-k2.6",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "OK" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const text = await drainSSE(buildCoercedSSEResponse(json));
    const finishLine = text
      .split("\n")
      .filter((l) => l.includes('"finish_reason":"stop"'))[0];
    expect(finishLine).toBeTruthy();
    const finishPayload = JSON.parse(finishLine.replace(/^data: /, ""));
    expect(finishPayload.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it("emits raw jsonResponse when choices/message are absent", async () => {
    const json = { object: "error", message: "something went wrong" };
    const text = await drainSSE(buildCoercedSSEResponse(json));
    expect(text).toContain("something went wrong");
    expect(text).toContain("data: [DONE]");
  });

  it("produces role delta before content delta", async () => {
    const json = {
      id: "order-id",
      created: 1700000004,
      model: "x",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hi" },
          finish_reason: "stop",
        },
      ],
    };
    const text = await drainSSE(buildCoercedSSEResponse(json));
    const roleIdx = text.indexOf('"role":"assistant"');
    const contentIdx = text.indexOf('"content":"hi"');
    expect(roleIdx).toBeGreaterThanOrEqual(0);
    expect(contentIdx).toBeGreaterThanOrEqual(0);
    expect(roleIdx).toBeLessThan(contentIdx);
  });
});

// ── Upstream stream:false coercion (e2e via handleChatCore) ──────────────
describe("NVIDIA Kimi stream coercion end-to-end", () => {
  const mockJsonBody = {
    choices: [
      {
        message: { role: "assistant", content: "mocked" },
        finish_reason: "stop",
      },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("coerces stream:true to stream:false on the upstream request body", async () => {
    proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify(mockJsonBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await handleChatCore({
      body: {
        model: "nvidia/kimi-k2.6",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      modelInfo: { provider: "nvidia", model: "kimi-k2.6" },
      credentials: { apiKey: "test-key" },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      clientRawRequest: { headers: {} },
    });

    // The response should be a synthetic SSE Response
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");

    // Verify the upstream fetch received a body with stream: false
    expect(proxyAwareFetch).toHaveBeenCalled();
    const [, fetchOpts] = proxyAwareFetch.mock.calls[0];
    const upstreamBody = JSON.parse(fetchOpts.body);
    expect(upstreamBody.stream).toBe(false);
  });

  it("does NOT coerce when stream is already false", async () => {
    proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify(mockJsonBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await handleChatCore({
      body: {
        model: "nvidia/kimi-k2.6",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
      modelInfo: { provider: "nvidia", model: "kimi-k2.6" },
      credentials: { apiKey: "test-key" },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      clientRawRequest: { headers: {} },
    });

    expect(result.success).toBe(true);
    const [, fetchOpts] = proxyAwareFetch.mock.calls[0];
    const upstreamBody = JSON.parse(fetchOpts.body);
    expect(upstreamBody.stream).toBe(false);
  });

  it("does NOT coerce for non-Kimi models on nvidia", async () => {
    proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify(mockJsonBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await handleChatCore({
      body: {
        model: "nvidia/llama-3.1-8b",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      modelInfo: { provider: "nvidia", model: "llama-3.1-8b" },
      credentials: { apiKey: "test-key" },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      clientRawRequest: { headers: {} },
    });

    expect(result.success).toBe(true);
    const [, fetchOpts] = proxyAwareFetch.mock.calls[0];
    const upstreamBody = JSON.parse(fetchOpts.body);
    // Non-Kimi should keep stream: true
    expect(upstreamBody.stream).toBe(true);
  });
});
