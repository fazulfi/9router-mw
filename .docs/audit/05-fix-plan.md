# 05 — Fix Plan

Exact diffs to apply, in order. Each patch is **independent** — if you stop after any one, you have a working state — but the symptom coverage is cumulative.

## Patch 1 — Drop the `tools.length > 0` gate on termination prompt

**File**: `open-sse/handlers/chatCore.js`
**Line**: 200
**Symptom**: Screenshot 2 (K2.7 prose-then-stop).

### Before (line 200-203)

```javascript
if (needsTerminationPrompt(provider, model) && Array.isArray(translatedBody.tools) && translatedBody.tools.length > 0) {
  injectTerminationPrompt(translatedBody, finalFormat);
  log?.debug?.("TERMINATION", `${provider}/${model} | ${finalFormat}`);
}
```

### After

```javascript
if (needsTerminationPrompt(provider, model)) {
  injectTerminationPrompt(translatedBody, finalFormat);
  log?.debug?.("TERMINATION", `${provider}/${model} | ${finalFormat}`);
}
```

### Why

The termination prompt content ("STOP calling tools and provide your final answer") is useful even when no tools are declared on this turn — it tells the model to summarize, not just to stop calling tools. K2.7's prose-then-stop happens because there is no anchoring instruction on the first turn.

`injectTerminationPrompt` is idempotent (see [`03-code-state.md`](./03-code-state.md) §"`injectTerminationPrompt` signature"). Multi-turn conversations that later add `tools` will not see a duplicate prompt.

### Risk

Low. The prompt is a soft hint. Worst case: a model that previously answered concisely now wraps its answer in "based on gathered information…" filler. Empirical check: K2.6 and K2.7 both benefit from this prompt per upstream docs.

### Test

Run `pnpm test tests/unit/termination-prompt.test.js` — already passing, no test changes needed.

---

## Patch 2 — Drop the `tools.length > 0` gate on tool protocol prompt

**File**: `open-sse/handlers/chatCore.js`
**Line**: 195
**Symptom**: Screenshot 2 (K2.7 prose-then-stop) — secondary effect.

### Before (line 195-198)

```javascript
if (TOOL_PROTOCOL_PROMPT_PROVIDERS.has(provider) && Array.isArray(translatedBody.tools) && translatedBody.tools.length > 0) {
  injectToolProtocolPrompt(translatedBody, finalFormat, extractToolNames(translatedBody.tools));
  log?.debug?.("TOOLPROTO", `${provider}/${model} | ${finalFormat}`);
}
```

### After

```javascript
if (TOOL_PROTOCOL_PROMPT_PROVIDERS.has(provider)) {
  injectToolProtocolPrompt(translatedBody, finalFormat, extractToolNames(translatedBody.tools));
  log?.debug?.("TOOLPROTO", `${provider}/${model} | ${finalFormat}`);
}
```

### Why

`injectToolProtocolPrompt` already handles the no-tools case — when `toolNames` is empty, it falls back to the base protocol text (line 42-45 of `terminationPrompt.js`). The outer gate was the only thing preventing the no-tools fallback from being useful.

### Risk

Low. Worst case: tool protocol text is injected on a chat-only request, slightly biasing the model toward looking for tools that aren't there. But K2.7's prose-then-stop is a worse failure mode.

### Test

Existing `termination-prompt.test.js` does not cover this path. Add one test:

```javascript
it("tool protocol prompt: invokes with empty tool list when no tools present", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };
  injectToolProtocolPrompt(body, FORMATS.OPENAI, []);
  expect(body.messages[0].content || body.messages[1]?.content).toContain("tool_call mechanism");
});
```

---

## Patch 3 — Wire `detectLoop` after translation

**File**: `open-sse/handlers/chatCore.js`
**Insert**: After line 198 (after the tool protocol block), before line 200 (termination block).
**Symptom**: Screenshot 1 (K2.6 overthinking loop).

### Add import (line 24 area)

```javascript
import { injectTerminationPrompt, injectToolProtocolPrompt } from "../rtk/terminationPrompt.js";
```

becomes

```javascript
import { detectLoop } from "../utils/loopGuard.js";
import { injectTerminationPrompt, injectToolProtocolPrompt } from "../rtk/terminationPrompt.js";
```

(Alphabetical within the import group — match existing style.)

### Add the loop-guard block

After line 198 (after the closing `}` of the tool-protocol block) and before line 200 (the termination block), insert:

```javascript
// Loop guard: detect repeated tool_call patterns in conversation history.
// Stateless — operates on translatedBody.messages only.
const loopCheck = detectLoop(translatedBody);
if (loopCheck.detected) {
  // Ensure termination prompt is present even on no-tools turns.
  injectTerminationPrompt(translatedBody, finalFormat);
  // Append hint to the last user/tool message so the model sees it as the
  // most recent instruction.
  const msgs = translatedBody.messages;
  if (Array.isArray(msgs)) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === "user" || msgs[i]?.role === "tool") {
        const hint = `\n\n[ROUTER NOTE: ${loopCheck.hint}]`;
        if (typeof msgs[i].content === "string") {
          msgs[i] = { ...msgs[i], content: msgs[i].content + hint };
        }
        break;
      }
    }
  }
  log?.warn?.("LOOPGUARD", `${provider}/${model} | loop detected, hint injected`);
}
```

### Why this placement

- **After translation** — `translatedBody.messages` is in target format; `detectLoop` reads `tool_calls` arrays which the translator preserves for the OpenAI-shape target (Kimchi is OpenAI transport, see `open-sse/providers/registry/kimchi.js:30`).
- **Before token savers** — Caveman/Ponytail inject system prompts; loop hint goes on a user/tool message and should be visible to the model first.
- **Idempotent with termination** — if the loop detector fires, we inject the termination prompt regardless of the `tools.length > 0` gate (which is now removed by Patch 1).

### Why append, not prepend

- Appending to the last message keeps the message count stable (no risk of breaking conversation structure).
- The hint sits in the most-recent-token position which has the strongest attention weight.
- If the last message is a `tool` result, the hint follows the tool output — same UX as Patch 1's termination prompt landing on the system message.

### Why we don't change `loopGuard.js`

The function is correct. Its hints are correct. Tests pass. Do not modify.

### Risk

Medium. This is the first time `detectLoop` runs in the active path. Watch for:

- False positives on legitimate multi-tool workflows (3 reads of the same file is legitimate if the model is exploring — but a real loop also produces 3 reads). Threshold of 3 is conservative.
- Hint injection may make the model re-plan in unexpected ways. The "change strategy" wording gives the model an out.

If false positives become a problem, add a circuit-breaker: only inject hint if `translatedBody.messages.length >= 5` (don't nudge on short histories where repetition is normal).

### Test

Add a test in `tests/unit/` (new file `tests/unit/loop-guard-wiring.test.js`):

```javascript
import { describe, it, expect, vi } from "vitest";

describe("loopGuard wiring in chatCore", () => {
  it("injects hint into last user message when loop detected", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    // Mock the executor
    vi.mock("../../open-sse/executors/index.js", () => ({
      getExecutor: () => ({
        execute: async () => ({
          response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }), { status: 200 }),
          url: "x", headers: {}, transformedBody: {},
        }),
      }),
    }));
    // Build a conversation with 3 identical bash tool_calls
    const body = {
      messages: [
        { role: "user", content: "list" },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "bash", arguments: '{"cmd":"ls"}' } }] },
        { role: "tool", content: "file1\nfile2" },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "bash", arguments: '{"cmd":"ls"}' } }] },
        { role: "tool", content: "file1\nfile2" },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "bash", arguments: '{"cmd":"ls"}' } }] },
      ],
    };
    // ... call handleChatCore, assert last user message contains "ROUTER NOTE"
  });
});
```

The full integration test should be deferred until Patches 1-3 are merged and can be smoke-tested manually.

---

## Patch 4 (optional, follow-up) — `max_tokens` clamp on NVIDIA Kimi

**File**: `open-sse/executors/default.js`
**Method**: `transformRequest`, after line 160
**Symptom**: Screenshot 3 (NVIDIA K2.6/K2.7 empty response).

### Add after line 160 (after `stripUnsupportedParams` call)

```javascript
// Kimi NVIDIA: NIM degeneration with max_tokens >= ~32k.
// Mirror of the clamp from commit 3dd7a9e5 (re-introduced with care).
if (this.provider === "nvidia" && /kimi-k2\.(6|7)/i.test(model)) {
  if (typeof body.max_tokens === "number" && body.max_tokens > 8192) {
    body.max_tokens = 8192;
  }
}
```

### Why

- The `kimi-max-tokens.test.js` file (`.skip`'d) defines this exact contract. After applying this patch, those tests can be un-`.skip`'d.
- No other model on NVIDIA is affected (the regex is Kimi-K2.6/K2.7-only).

### Risk

Medium. The original clamp existed and was removed. Before merging, check git log for the reason — there may have been a customer who relied on higher `max_tokens`. If so, the clamp should be conditional: only clamp when `reasoning_effort` is set to `high` or above.

**Decision rule**: If unsure, ship Patches 1-3 first and treat Patch 4 as a separate ticket. The Kimchi fixes are higher-impact (more users, more failure modes) and stand on their own.

### Test

Un-skip `tests/unit/kimi-max-tokens.test.js` after applying this patch. Verify all 4 tests pass.

---

## Summary of patches

| # | File | Lines | Symptom fixed | Risk |
|---|---|---|---|---|
| 1 | `chatCore.js:200` | -1 | Screenshot 2 | Low |
| 2 | `chatCore.js:195` | -1 | Screenshot 2 (secondary) | Low |
| 3 | `chatCore.js` (import + new block) | +18 | Screenshot 1 | Medium |
| 4 | `default.js` (new clamp) | +5 | Screenshot 3 | Medium |

Patches 1-3 are the minimum viable fix. Patch 4 is a clean follow-up.

## Order of operations

1. Apply Patch 1 + Patch 2 as a single commit (`fix(kimi): drop tools.length gate so termination fires on first turn`).
2. Apply Patch 3 as a second commit (`fix(kimi): wire loopGuard in chatCore to catch planning loops`).
3. Run `pnpm test tests/unit/loop-guard.test.js` and `pnpm test tests/unit/termination-prompt.test.js`.
4. Manual smoke test with a real Kimchi API key against `kimchi/kimi-k2.6` and `kimchi/kimi-k2.7` using a multi-turn agent task.
5. Decide on Patch 4 based on whether NVIDIA Kimi empty responses are still being seen by users.

## What NOT to change

- `capabilities.js` Kimi entries — leave alone.
- `thinkingUnified.js` `case "kimi":` — leave alone.
- `reasoningContentInjector.js` scope — leave alone (YAGNI until measured).
- `loopGuard.js` — leave alone.
- `paramSupport.js` — leave alone.

Each of these was tempting to change during the investigation but the audit confirms none of them are the root cause of the reported symptoms.
