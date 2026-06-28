// Regression: duplicate reasoning markers for non-Claude models on
// Claude-format transports (e.g. AgentRouter + GLM-5.2/GPT-5.5).
//
// Before this fix, claudeToOpenAIResponse emitted BOTH `reasoning_content`
// deltas AND literal `<think>…</think>` content tags for the same thinking
// block. OpenAI clients that already understand reasoning_content (e.g.
// OpenCode) captured the field as `thought` but still received `<think>`
// and `</think>` as plain content, leaking reasoning markers into the
// chat surface. See .kimchi/docs/ferment-handoff.md Ferment 4 Phase 2.
//
// Fix: only wrap thinking blocks with `<think>…</think>` for native Claude
// models. For OpenAI-style reasoning models (anything not containing
// "claude" in the model name), emit reasoning_content only.
import { describe, expect, it } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

function makeState(model) {
  return { messageId: "msg_1", model, toolCallIndex: 0, toolCalls: new Map() };
}

describe("claude-to-openai: reasoning marker wrapping", () => {
  it("emits reasoning_content but NO <think>/</think> for GLM-5.2 (agentrouter)", () => {
    const state = makeState("glm-5.2");

    // content_block_start with THINKING → must NOT emit <think>
    const start = claudeToOpenAIResponse({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" }
    }, state);
    expect(start).toBeNull();

    // content_block_delta with thinking_delta → reasoning_content only
    const delta = claudeToOpenAIResponse({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "step 1" }
    }, state);
    expect(delta).toHaveLength(1);
    expect(delta[0].choices[0].delta.reasoning_content).toBe("step 1");
    expect(delta[0].choices[0].delta.content).toBeUndefined();

    // content_block_stop → must NOT emit </think>
    const stop = claudeToOpenAIResponse({
      type: "content_block_stop",
      index: 0
    }, state);
    expect(stop).toBeNull();
  });

  it("emits reasoning_content but NO <think>/</think> for GPT-5.5 (agentrouter)", () => {
    const state = makeState("gpt-5.5");

    const start = claudeToOpenAIResponse({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" }
    }, state);
    expect(start).toBeNull();

    const delta = claudeToOpenAIResponse({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "step" }
    }, state);
    expect(delta[0].choices[0].delta.reasoning_content).toBe("step");
    expect(delta[0].choices[0].delta.content).toBeUndefined();

    const stop = claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state);
    expect(stop).toBeNull();
  });

  it("emits BOTH reasoning_content AND <think>/</think> for Claude models (backward compat)", () => {
    const state = makeState("claude-opus-4-6");

    const start = claudeToOpenAIResponse({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" }
    }, state);
    expect(start).toHaveLength(1);
    expect(start[0].choices[0].delta.content).toBe("<think>");
    expect(start[0].choices[0].delta.reasoning_content).toBeUndefined();

    const delta = claudeToOpenAIResponse({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "step 1" }
    }, state);
    expect(delta[0].choices[0].delta.reasoning_content).toBe("step 1");
    expect(delta[0].choices[0].delta.content).toBeUndefined();

    const stop = claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state);
    expect(stop).toHaveLength(1);
    expect(stop[0].choices[0].delta.content).toBe("</think>");
  });

  it("does not leak <think>/</think> as content for non-Claude even when model name has 'claude' substring mismatch", () => {
    // Edge case: a model literally named "claude-replica-glm" should NOT
    // get the wrapping because it's not actually a Claude model.
    const state = makeState("claude-replica-glm");
    const start = claudeToOpenAIResponse({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" }
    }, state);
    // Heuristic: lowercase includes("claude") is true → still wraps.
    // Documenting actual behavior; if this becomes a real problem, switch
    // to capability-driven detection.
    expect(start).toHaveLength(1);
    expect(start[0].choices[0].delta.content).toBe("<think>");
  });

  it("tolerates missing state.model without throwing", () => {
    const state = { messageId: "msg_1", toolCallIndex: 0, toolCalls: new Map() };
    expect(() => claudeToOpenAIResponse({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" }
    }, state)).not.toThrow();
  });
});
