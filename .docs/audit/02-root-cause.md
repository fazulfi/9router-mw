# 02 — Root Cause

Why each symptom happens, traced from observable behavior to the responsible code.

## Symptom 1 (K2.6 overthinking loop) — cause: no termination prompt at the right phase

**Mechanism**: The termination prompt in `open-sse/rtk/terminationPrompt.js:12` is:

> "When you have gathered sufficient information to answer the request, STOP calling tools and provide your final answer. Do not call a tool with the same arguments more than once. If a previous attempt returned the same result, change strategy or summarize with available data."

This prompt is only useful **after** the model has gathered information. K2.6 in screenshot 1 is in the *planning* phase, before any tool call. The prompt tells it to stop *calling tools* — but it has not yet decided to call any tool, only to plan.

The loop is therefore: model emits plan → re-reads plan → emits "I need to read…" → re-reads plan → repeat.

The prompt also contains nothing about *planning*. It assumes the model has already crossed the planning threshold.

**Why this didn't get caught earlier**: Commit `c76c9105` (the only Kimi termination hardening we have) wired the prompt in but gated it on `Array.isArray(translatedBody.tools) && translatedBody.tools.length > 0` — see [`03-code-state.md`](./03-code-state.md). The gate is appropriate when the prompt is about stopping *tool calls*; it is wrong as a general anti-loop signal for K2.6/K2.7.

## Symptom 2 (K2.7 prose-then-stop) — cause: termination prompt skipped + no tool protocol enforcement

**Two compounding causes**:

1. **Termination prompt skipped**. Same gate as above: first-turn user query with no `tools` array on the request means `needsTerminationPrompt()` returns `true` but the gate at `chatCore.js:200` filters it out. K2.7 never gets the hint.

2. **Tool protocol prompt skipped**. The "Tool protocol: call tools only through the structured tool_call mechanism…" prompt at `terminationPrompt.js:14` is also gated on `tools.length > 0` (chatCore.js:195). On the first turn, the client may not have attached `tools` to the request — the model sees the user message, intends to use a tool, but has no schema and no protocol reminder in context. It then describes its intent in prose because that is the only format available without `tools`.

**Why the gate exists at all**: The tool protocol prompt names tools (`Valid tool names: …`), so injecting it when there are no tools makes the names list empty and the prompt degrades to a generic instruction. That is still useful, but the current code returns early when `tool_names.length === 0` (see `injectToolProtocolPrompt` in `terminationPrompt.js:40-65`). For the prompt to be useful with no tools, we need to allow the no-tools fallback to inject anyway.

## Symptom 3 (NVIDIA empty response) — cause: thinkingFormat mismatch + missing budget cap on this path

`open-sse/providers/capabilities.js:125-126`:

```javascript
"kimi-k2.7": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, … },
"kimi-k2.6": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, … },
```

Note `thinkingFormat: "openai"` for the NVIDIA Kimi entries — **different** from the Kimchi entries on line 99-100 which say `thinkingFormat: "kimi"`.

In `open-sse/translator/concerns/thinkingUnified.js:163-168` the `case "openai":` branch:

```javascript
case "openai": {
  if (none && canDisable) { body.reasoning_effort = "none"; break; }
  const level = toLevel(eff);
  if (level) body.reasoning_effort = level === "xhigh" || level === "max" ? "high" : level;
  break;
}
```

This branch only sets `reasoning_effort`. It does not clamp `max_tokens`.

Compare to the Kimchi path (`case "kimi":`, line 213-218):

```javascript
case "kimi": {
  if (none && canDisable) { body.reasoning_effort = "none"; break; }
  const level = toLevel(eff);
  if (level) body.reasoning_effort = level === "max" ? "high" : level;
  break;
}
```

Same shape. **Neither** branch caps `max_tokens`.

Now consider what happens on `nvidia/moonshotai/kimi-k2.6(high)`:

1. Client sends `reasoning_effort: "high"` (or our `(high)` suffix translates to that).
2. Translator sets `body.reasoning_effort = "high"`.
3. `max_tokens` is left as whatever the client sent — typically the default 4096-16384 range, or higher.
4. NIM K2.6 is known (per commit `3dd7a9e5` evidence) to **degenerate** when `max_tokens` is ≥ ~32k: it loops inside reasoning or returns empty content.

That commit added a clamp on the **executor** side (`open-sse/executors/default.js`) but it is **not present in the current executor** — the clamp was reverted or never merged into the active code path. `tests/unit/kimi-max-tokens.test.js` is fully `.skip`'d. See [`03-code-state.md`](./03-code-state.md) §"Where the clamp should be".

**Result**: Large `max_tokens` reaches NIM, reasoning drains the budget, no content token is produced, the request terminates with empty body after ~11.9s.

## Summary table

| Symptom | Root cause | Where to fix |
|---|---|---|
| K2.6 overthinking loop | Termination prompt only useful post-plan; loop detector not wired | `chatCore.js` import + wire `detectLoop` |
| K2.7 prose-then-stop | Termination + tool-protocol prompts gated on `tools.length > 0` | `chatCore.js:195` and `:200` drop the gate (or move it inside the function) |
| NVIDIA K2.6/K2.7 empty | `max_tokens` not clamped on NVIDIA path | `default.js` `transformRequest` or executor-level hook |

Each row maps to one file in [`05-fix-plan.md`](./05-fix-plan.md).
