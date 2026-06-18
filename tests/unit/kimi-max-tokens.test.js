import { beforeEach, describe, it, expect, vi } from "vitest";

// 9Router clamps max_tokens to a safe ceiling (8192) for Kimi NVIDIA — empirically a
// large value (≥~32k) makes the model degenerate/loop. Smaller values pass through; it
// never INJECTS a value when the client omits it.
describe.skip("Kimi NVIDIA max_tokens clamp", () => {
  beforeEach(() => { vi.resetModules(); });

  async function calledBody(bodyExtra) {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");
    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: {},
    });
    await executor.execute({
      model: "moonshotai/kimi-k2.6",
      body: { messages: [{ role: "user", content: "hello" }], ...bodyExtra },
      stream: false, credentials: { apiKey: "k" }, signal: undefined, log: undefined, proxyOptions: null,
    });
    return baseSpy.mock.calls[0][0].body;
  }

  it("clamps a large max_tokens (64000) to the 8192 ceiling", async () => {
    expect((await calledBody({ max_tokens: 64000 })).max_tokens).toBe(8192);
  });

  it("honors a small max_tokens (2048) unchanged", async () => {
    expect((await calledBody({ max_tokens: 2048 })).max_tokens).toBe(2048);
  });

  it("does NOT inject max_tokens when client omits it", async () => {
    expect((await calledBody({})).max_tokens).toBeUndefined();
  });

  it("does NOT clamp non-Kimi NVIDIA models", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");
    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: {},
    });
    await executor.execute({
      model: "meta/llama-3.1-8b-instruct",
      body: { messages: [{ role: "user", content: "hi" }], max_tokens: 64000 },
      stream: false, credentials: { apiKey: "k" }, signal: undefined, log: undefined, proxyOptions: null,
    });
    expect(baseSpy.mock.calls[0][0].body.max_tokens).toBe(64000);
  });
});
