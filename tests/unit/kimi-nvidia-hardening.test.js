import { beforeEach, describe, expect, it, vi } from "vitest";

describe.skip("Kimi NVIDIA hardening", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ── isKimiToolFailure ────────────────────────────────────────────────────

  it("flags repetition_detected as tool-call failure when tools were requested", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.isKimiToolFailure({
      stopReason: "repetition_detected",
      content: "plain text",
      expectsToolCalls: true,
    })).toBe(true);
  });

  it("flags repetition (short) stop reason as tool-call failure", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.isKimiToolFailure({
      stopReason: "repetition",
      content: "some text",
      expectsToolCalls: true,
    })).toBe(true);
  });

  it("does not flag repetition_detected when request had no tools", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.isKimiToolFailure({
      stopReason: "repetition_detected",
      content: "plain text",
      expectsToolCalls: false,
    })).toBe(false);
  });

  it("flags long unstructured plain text as tool-call failure in tool mode", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    const longText = "x".repeat(240);
    expect(mod.__testing.isKimiToolFailure({
      stopReason: "stop",
      content: longText,
      expectsToolCalls: true,
    })).toBe(true);
  });

  it("does not flag short plain text as failure (model may genuinely respond with text)", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.isKimiToolFailure({
      stopReason: "stop",
      content: "short reply",
      expectsToolCalls: true,
    })).toBe(false);
  });

  it("does not flag structured Kimi XML tool blocks as failure", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    const content = '<invoke name="functions.bash"><parameter name="cmd">pwd</parameter></invoke>';
    expect(mod.__testing.isKimiToolFailure({
      stopReason: "stop",
      content,
      expectsToolCalls: true,
    })).toBe(false);
  });

  it("does not flag Kimi special-token tool blocks as failure", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    const content = "<|tool_calls_section_begin|><|tool_call_begin|>bash<|tool_call_argument_begin|>{\"command\":\"ls\"}<|tool_call_end|><|tool_calls_section_end|>";
    expect(mod.__testing.isKimiToolFailure({
      stopReason: "stop",
      content,
      expectsToolCalls: true,
    })).toBe(false);
  });

  // ── requestExpectsToolCalls ──────────────────────────────────────────────

  it("detects tool expectations when tools array is present and tool_choice is auto", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.requestExpectsToolCalls({
      tools: [{ type: "function", function: { name: "bash" } }],
      tool_choice: "auto",
    })).toBe(true);
  });

  it("detects tool expectations when tools array is present and no tool_choice set", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.requestExpectsToolCalls({
      tools: [{ type: "function", function: { name: "bash" } }],
    })).toBe(true);
  });

  it("does not detect tool expectations when tool_choice is none", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.requestExpectsToolCalls({
      tools: [{ type: "function", function: { name: "bash" } }],
      tool_choice: "none",
    })).toBe(false);
  });

  it("does not detect tool expectations when tools array is empty", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.requestExpectsToolCalls({ tools: [] })).toBe(false);
  });

  it("does not detect tool expectations when body has no tools", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    expect(mod.__testing.requestExpectsToolCalls({ messages: [] })).toBe(false);
  });

  // ── DefaultExecutor.execute – Kimi NVIDIA tool path (honor client, no interference) ──
  // 9Router passes the request through unchanged (no forced tool_choice, no injected
  // max_tokens) so behavior matches direct-NVIDIA usage. Response-side hardening still
  // fail-fasts on repetition/garbage so combos can fall back.

  it("honors client tool_choice and does NOT inject max_tokens (passthrough)", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");
    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "bash", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: {},
    });

    await executor.execute({
      model: "moonshotai/kimi-k2.6",
      body: { messages: [{ role: "user", content: "list" }], tools: [{ type: "function", function: { name: "bash" } }], tool_choice: "auto" },
      stream: false, credentials: { apiKey: "k" }, signal: undefined, log: undefined, proxyOptions: null,
    });

    expect(baseSpy).toHaveBeenCalledOnce();
    const calledBody = baseSpy.mock.calls[0][0].body;
    expect(calledBody.tool_choice).toBe("auto");      // honored, not forced
    expect(calledBody.max_tokens).toBeUndefined();    // NOT injected (matches direct usage)
  });

  it("passes through native tool_calls from NVIDIA", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");
    vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"ls /tmp"}' } }] }, finish_reason: "tool_calls" }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: {},
    });

    const result = await executor.execute({
      model: "moonshotai/kimi-k2.6",
      body: { messages: [{ role: "user", content: "ls" }], tools: [{ type: "function", function: { name: "bash" } }], tool_choice: "required" },
      stream: false, credentials: { apiKey: "k" }, signal: undefined, log: undefined, proxyOptions: null,
    });
    const parsed = await result.response.json();
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe("bash");
  });

  it("fail-fasts on repetition_detected (response-side hardening → fallback)", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");
    vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "the problem is a problem", tool_calls: [] }, finish_reason: "repetition", stop_reason: "repetition_detected" }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: {},
    });

    await expect(executor.execute({
      model: "moonshotai/kimi-k2.6",
      body: { messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "bash" } }], tool_choice: "required" },
      stream: false, credentials: { apiKey: "k" }, signal: undefined, log: undefined, proxyOptions: null,
    })).rejects.toThrow(/Kimi tool-call failure/i);
  });

  it("allows plain Kimi chat requests without tool_choice override", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");

    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      url: "https://example.test",
      headers: {},
      transformedBody: {},
    });

    await expect(executor.execute({
      model: "moonshotai/kimi-k2.6",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials: { apiKey: "k" },
      signal: undefined,
      log: undefined,
      proxyOptions: null,
    })).resolves.toMatchObject({ url: "https://example.test" });

    expect(baseSpy).toHaveBeenCalledOnce();
    // No tool_choice injected for plain chat
    const calledBody = baseSpy.mock.calls[0][0].body;
    expect(calledBody.tool_choice).toBeUndefined();
  });

  it("does not override tool_choice for non-Kimi models", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");

    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      url: "https://example.test",
      headers: {},
      transformedBody: {},
    });

    await executor.execute({
      model: "meta/llama-3.1-8b-instruct",
      body: {
        messages: [{ role: "user", content: "list files" }],
        tools: [{ type: "function", function: { name: "bash" } }],
        tool_choice: "auto",
      },
      stream: false,
      credentials: { apiKey: "k" },
      signal: undefined,
      log: undefined,
      proxyOptions: null,
    });

    const calledBody = baseSpy.mock.calls[0][0].body;
    // tool_choice stays "auto" for non-Kimi models
    expect(calledBody.tool_choice).toBe("auto");
  });
});
