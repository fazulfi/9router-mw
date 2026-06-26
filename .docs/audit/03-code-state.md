# 03 — Code State

What the code does today, file by file, with line references.

## `open-sse/handlers/chatCore.js`

### Termination prompt wiring (line 200-203)

```javascript
if (needsTerminationPrompt(provider, model) && Array.isArray(translatedBody.tools) && translatedBody.tools.length > 0) {
  injectTerminationPrompt(translatedBody, finalFormat);
  log?.debug?.("TERMINATION", `${provider}/${model} | ${finalFormat}`);
}
```

- `needsTerminationPrompt` (line 33-35) matches `kimi-k2.6` and `kimi-k2.7` patterns.
- Gate on `tools.length > 0` means: if the client request has no tools, **no termination prompt**.
- For first-turn queries (screenshot 2), this is the wrong gate.

### Tool protocol prompt wiring (line 195-198)

```javascript
if (TOOL_PROTOCOL_PROMPT_PROVIDERS.has(provider) && Array.isArray(translatedBody.tools) && translatedBody.tools.length > 0) {
  injectToolProtocolPrompt(translatedBody, finalFormat, extractToolNames(translatedBody.tools));
  log?.debug?.("TOOLPROTO", `${provider}/${model} | ${finalFormat}`);
}
```

- `TOOL_PROTOCOL_PROMPT_PROVIDERS = new Set(["kimchi", "nvidia"])` — line 31.
- Same `tools.length > 0` gate.
- `extractToolNames` returns `[]` when no tools, and `injectToolProtocolPrompt` then injects just the protocol text without the tool names list (line 40-46 of `terminationPrompt.js`). The function is safe to call with empty `toolNames`, but the outer gate in `chatCore.js` blocks the call.

### No loop detector wired

A grep across the repo confirms `detectLoop` is referenced **only** in:

- `open-sse/utils/loopGuard.js` — definition.
- `tests/unit/loop-guard.test.js` — tests (9 cases, all passing).

It is not imported anywhere in the chat path. The original commit `3dd7a9e5` added a wire-up but it was removed in a later refactor. The infrastructure is dead code.

### Where the loop detector would slot in

After translation (around line 175) and before token-saver injection (line 184-193), or as a third step after the termination prompt at line 200-203. Putting it after the termination prompt is cleaner because:

- Termination prompt is unconditional-on-tools (after our fix).
- Loop hint injection can mutate the last user/tool message in place.
- Single decision point: "do we have a problem we need to nudge the model about?"

## `open-sse/rtk/terminationPrompt.js`

### Prompt content (line 12)

```javascript
const TERMINATION_PROMPT = `When you have gathered sufficient information to answer the request, STOP calling tools and provide your final answer. Do not call a tool with the same arguments more than once. If a previous attempt returned the same result, change strategy or summarize with available data.`;
```

- Anti-repetition bias: present.
- Stop-when-done bias: present.
- Plan-then-act bias: **missing**.
- Tool-call-format bias: **missing** — see Tool Protocol Prompt below.

### Tool Protocol Prompt content (line 14)

```javascript
const TOOL_PROTOCOL_PROMPT = `Tool protocol: call tools only through the structured tool_call mechanism. Use tool names exactly as listed; do not add prefixes, namespaces, dots, or concatenate words. Never invent tool names.`;
```

This is exactly what K2.7 in screenshot 2 needs. It is currently skipped when no tools.

### `injectToolProtocolPrompt` signature (line 40)

```javascript
export function injectToolProtocolPrompt(body, format, toolNames = []) {
  …
  const prompt = names.length > 0
    ? `${TOOL_PROTOCOL_PROMPT} Valid tool names: ${names.join(", ")}.`
    : TOOL_PROTOCOL_PROMPT;
  …
}
```

Already supports zero-tool-names fallback — the prompt text alone is injected. We just need the outer caller to invoke it.

### Format-specific system-message injection

- `injectMessagesSystem` (line 68-83) — handles OpenAI shape, idempotent via substring check.
- `injectClaudeSystem` (line 98-110) — Claude format.
- `injectGeminiSystem` (line 112-123) — Gemini and variants.
- `injectKiroSystem` (line 125-132) — Kiro envelope.

All idempotent. Multiple calls do not duplicate the prompt.

## `open-sse/utils/loopGuard.js`

### Full file inventory (112 lines)

- Constants: `SINGLE_REPEAT_THRESHOLD = 3`, `SEQUENCE_REPEAT_THRESHOLD = 2`, `MIN_SEQUENCE_LENGTH = 2`.
- `normalizeArgs` — sorts object keys so `{b:1,a:2}` and `{a:2,b:1}` hash the same.
- `toolCallHash` — hashes by `name::normalized-args`.
- `extractToolCallSequence` — flattens assistant `tool_calls` arrays in order.
- `detectSingleRepeat` — finds any tool call appearing ≥ 3 times.
- `detectSequenceRepeat` — sliding window N-gram match, returns the first repeated sequence.
- `detectLoop` — entry point. Returns `{ detected: bool, hint: string | null }`.

### Hint messages (line 99 and 107)

- Single repeat: *"You have called the same tool with identical arguments multiple times with no new progress. STOP repeating. Summarize findings from existing results or change your strategy."*
- Sequence repeat: *"You have repeated the same sequence of tool calls multiple times. This is a loop. STOP this pattern immediately. Summarize what you have already found or take a completely different approach."*

Both end in imperative "STOP" + "summarize". Useful in themselves, but they only fire when tool_calls are already happening. They do **not** help with the K2.6 "I need to read…" case (no tool call yet — it's a text-only planning loop in the response).

This is why the planner-phase fix needs to come from the termination prompt widening its gate, not from the loop detector alone.

## `open-sse/utils/reasoningContentInjector.js`

### Scope of placeholder injection (line 12-15)

```javascript
const MODEL_RULES = [
  { match: m => /(?:^|\/)kimi-/i.test(m || ""), scope: "toolCalls" },
  { match: m => /deepseek/i.test(m || ""), scope: "all" }
];
```

- Kimi models: placeholder `reasoning_content` is injected only on assistant messages that have `tool_calls` (scope `toolCalls`).
- DeepSeek models: every assistant message.

### `shouldInject` (line 29-35)

```javascript
function shouldInject(message, scope) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}
```

So Kimi assistant messages without `tool_calls` are passed through unchanged. If Kimi upstream requires `reasoning_content` on **every** assistant message (not just tool-call ones), this would explain screenshot 2-style failures when the model emits a prose response. **But** — this is speculation, not measured. Treat as low-priority follow-up; do not change without evidence.

## `open-sse/translator/concerns/thinkingUnified.js`

### `case "kimi":` (line 213-218)

```javascript
case "kimi": {
  if (none && canDisable) { body.reasoning_effort = "none"; break; }
  const level = toLevel(eff);
  if (level) body.reasoning_effort = level === "max" ? "high" : level;
  break;
}
```

Sets `reasoning_effort` only. Does not cap `max_tokens`.

### `case "openai":` (line 163-168)

```javascript
case "openai": {
  if (none && canDisable) { body.reasoning_effort = "none"; break; }
  const level = toLevel(eff);
  if (level) body.reasoning_effort = level === "xhigh" || level === "max" ? "high" : level;
  break;
}
```

Same shape. Neither branch caps `max_tokens`. Neither branch emits any `thinking: { budget_tokens: ... }` object.

This means the only protection against runaway reasoning on the **translation** side is whatever `capabilities.thinkingRange` produces, and that field is **not set** for any Kimi variant. See `capabilities.js:99-100` (Kimchi) and `:125-126` (NVIDIA, codebuddy-cn).

### Where the clamp should be (for NVIDIA path)

The cleanest place to clamp `max_tokens` for NVIDIA Kimi is in `open-sse/executors/default.js`'s `transformRequest` method (line 152-164) — right where `stripUnsupportedParams` and `injectReasoningContent` are called. One branch:

```javascript
if (/kimi-k2\.(6|7)/i.test(model)) {
  if (typeof body.max_tokens === "number" && body.max_tokens > 8192) {
    body.max_tokens = 8192;
  }
}
```

Honors client-set values ≤ 8192, clamps larger values, never injects when absent. Mirrors the pattern from commit `3dd7a9e5`.

## `open-sse/providers/capabilities.js`

### Kimchi Kimi (line 99-101)

```javascript
"kimi-k2.7":              { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: 262144 },
"kimi-k2.6":              { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: 262144 },
"kimi-k2.5":              { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: 262144 },
```

- `thinkingFormat: "kimi"` → routes to `case "kimi":` in `thinkingUnified.js`, which sets `reasoning_effort` only.
- No `thinkingRange` cap.
- `maxOutput: 262144` — runway is huge.

### NVIDIA Kimi (line 125-126, currently missing — see note)

> **NOTE**: `open-sse/providers/capabilities.js` does **not** currently have explicit `nvidia:` overrides for `kimi-k2.6` / `kimi-k2.7`. The match falls through to `PATTERN_CAPABILITIES[].pattern: "*kimi*k2*"` (line 205) which yields `thinkingFormat: "kimi"` — same as Kimchi.
>
> The reference to `capabilities.js:125-126` in some commit messages refers to the **codebuddy-cn** provider's Kimi entries (also `thinkingFormat: "openai"`), not NVIDIA NIM. **Do not confuse the two.**

The reality on the wire today:

- Kimchi `kimi-k2.6` → `thinkingFormat: "kimi"` → `case "kimi":` in `thinkingUnified.js`.
- NVIDIA `moonshotai/kimi-k2.6` → falls to pattern → `thinkingFormat: "kimi"` → same `case "kimi":`.
- Codebuddy-cn `kimi-k2.6` → explicit `thinkingFormat: "openai"` → `case "openai":`.

So the "case openai" branch is only relevant to codebuddy-cn and unrelated OpenAI-format providers. NVIDIA Kimi is actually on the "kimi" branch.

### Where the max_tokens clamp should go

For NVIDIA Kimi specifically — `open-sse/executors/default.js` `transformRequest`, gated on `provider === "nvidia"` AND model matches `/kimi-k2\.(6|7)/i`. See the proposed patch in [`05-fix-plan.md`](./05-fix-plan.md).

## `tests/`

### `tests/unit/loop-guard.test.js` (86 lines, all passing)

Covers:

- Empty messages → not detected.
- 3 identical tool_calls → detected.
- 2 identical tool_calls → not detected (below threshold).
- 3 calls with different args → not detected.
- 3 calls with different names → not detected.
- Sequence `[fetchA, fetchB]` × 2 → detected.
- Sequence appearing once → not detected.
- Args normalization (`{b:1,a:2}` ≡ `{a:2,b:1}`).
- No tool_calls in messages → not detected.

This test file is the **proof** that the detector works as advertised. Any patch that wires it into `chatCore.js` can run this test to confirm no regression.

### `tests/unit/kimi-max-tokens.test.js` (52 lines, all `.skip`)

Tests for the NVIDIA Kimi `max_tokens` clamp:

- `> 64000` → clamped to `8192`.
- `< 8192` → honored unchanged.
- omitted → not injected.
- non-Kimi NVIDIA model → not clamped.

All four are `describe.skip`. They define the contract for the clamp when we add it.

### `tests/unit/kimi-nvidia-hardening.test.js` (235 lines, all `.skip`)

Larger suite for response-side Kimi NVIDIA hardening. Includes:

- `isKimiToolFailure` — flags `repetition_detected` and unstructured long text as tool-call failures.
- `requestExpectsToolCalls` — detects when client requests tools.
- DefaultExecutor passthrough tests (tools honored, not forced).
- Fail-fast on repetition → fallback.

All `.skip`. The skip is intentional per commit `3dd7a9e5`'s message: *"Termination-prompt/loop-guard infra kept but disabled."* Re-enable selectively after a real fix lands and is verified.

## Summary of gaps

| Gap | Severity | File | Fix difficulty |
|---|---|---|---|
| Termination prompt gated on `tools.length > 0` | High (screenshots 1, 2) | `chatCore.js:200` | 1 line |
| Tool protocol prompt gated on `tools.length > 0` | Medium (screenshot 2) | `chatCore.js:195` | 1 line |
| `detectLoop` not wired | High (screenshot 1) | `chatCore.js` | ~10 lines |
| No `max_tokens` clamp on NVIDIA Kimi | Medium (screenshot 3) | `default.js` | 5 lines |
| `reasoning_content` scope may be too narrow | Low (speculative) | `reasoningContentInjector.js` | Investigation first |

The first three are the minimum to ship. The fourth is a clean follow-up. The fifth is YAGNI until measured.
