# 01 — Symptoms

User-visible failures across Kimi reasoning models routed through 9router.

## Screenshot 1 — `kimchi/kimi-k2.6` overthinking loop

**Observed**: Model emits repeated planning phrases without progressing.

```
"I need to read the key files..."
"Let me continue reading..."
"I need to look at the key files related to kimchi..."
"I need to read the key files..."
```

The model never reaches a tool call. After ~2 minutes the response is aborted by the user.

**Telemetry** (from earlier session): "Thought for 1m 49s, searched for 2 patterns, read 3 files, ran 1 shell command".

**Failure mode**: Reasoning drain without tool execution. The model is stuck in a planning loop in its thinking trace.

## Screenshot 2 — `kimchi/kimi-k2.7` silent stop before tool call

**Trigger**: User asks in Indonesian — "cek apakah anda menemukan ada project bernama 9routes disini" (check whether you find a project named 9routes here).

**Observed**:

1. Model converts the query to an internal plan: "search for a directory/file named 9routes in the working directory, likely via glob".
2. Emits this plan as natural language text in the response.
3. Returns with `finish_reason: stop` — **no `tool_calls` field**.

**Telemetry**: "Kimchi-Auto · ki/kimi-k2.7 · 3.3s" — total wall time 3.3s.

**Failure mode**: Model intends to use a tool but emits the intent as prose instead of a structured `tool_calls` array. Then stops cleanly because there is no reason to continue.

## Screenshot 3 — `nvidia/moonshotai/kimi-k2.6(high)` empty response

**Trigger**: User says "lanjutkan" (continue).

**Observed**: Empty response body returned in 11.9s.

**Telemetry**: "Kimchi-Auto · nvidia/moonshotai/kimi-k2.6(high) · 11.9s".

**Failure mode**: Request never produces an output token. Either:
- Reasoning budget drained entirely on thinking (no room left for content), or
- Upstream NIM rejected the request mid-think, or
- Streaming parser dropped a malformed frame.

The 11.9s wall time matches typical NIM cold-start + think-time for K2.6(high). The same pattern was reproduced for K2.7 on NVIDIA — same 11.9s, same empty body.

## Common pattern

All four symptoms share one trait: **the model fails to produce a structured `tool_calls` response when the user prompt implies tool use**.

- K2.6 (Kimchi): loops in planning → never calls tool
- K2.7 (Kimchi): plans in prose → stops cleanly without calling tool
- K2.6/K2.7 (NVIDIA): thinks → runs out of budget before content

These are not four separate bugs. They are four presentations of the same underlying issue: the model has no clear anchor telling it "stop thinking and emit the tool call structure now" or "summarize what you already have and finish".

## What's NOT the bug

- The translation pipeline is fine — body shape is correct on the wire.
- Tool definitions are correctly attached when present.
- Auth, URL, headers — all working (the request reaches upstream and gets a response, even if empty).
- The bug is upstream behavior; 9router needs to give the model better stopping conditions.
