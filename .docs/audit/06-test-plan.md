# 06 — Test Plan

How to verify each patch before merging. Run tests in this order; do not skip.

## Phase 1 — Unit tests (no network)

### Existing tests that must remain green

```bash
pnpm test tests/unit/loop-guard.test.js
```

**Expected**: 9 tests pass. The file was last touched in commit `3dd7a9e5` and has been green since. Patch 3 wires `detectLoop` into `chatCore.js` but does **not** modify `loopGuard.js`. This test should be untouched.

```bash
pnpm test tests/unit/termination-prompt.test.js
```

**Expected**: All 9 tests pass. Patch 1 widens the gate in `chatCore.js` but does **not** modify `terminationPrompt.js` itself. This test should be untouched.

```bash
pnpm test tests/translator/thinking-unified.test.js
```

**Expected**: All tests pass. None of the patches modify `thinkingUnified.js`. Sanity check only.

### New unit tests to add (per Patch 2 and Patch 3)

#### `tests/unit/termination-prompt.test.js` — add 1 test

```javascript
it("tool protocol prompt: invokes with empty tool list when no tools present", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };
  injectToolProtocolPrompt(body, FORMATS.OPENAI, []);
  const allContent = JSON.stringify(body.messages);
  expect(allContent).toContain("tool_call mechanism");
});
```

This validates that `injectToolProtocolPrompt` works without tools (it already does — the test just locks in the contract).

#### `tests/unit/loop-guard-wiring.test.js` — new file

See Patch 3 in [`05-fix-plan.md`](./05-fix-plan.md) for the structure. The test:

1. Builds a conversation with 3 identical `bash` tool calls (triggers `detectLoop`).
2. Calls `handleChatCore` with mocked executor.
3. Asserts the last user/tool message contains `"ROUTER NOTE"`.

Mark with `it.skip` if mocking `handleChatCore` is too involved (it imports a lot). In that case, write a focused test that imports only the loop-wiring helper if you extract it into a separate function — see §"Extraction note" below.

### Extraction note (optional refactor)

If writing the integration test feels heavy, extract the loop-wiring into a helper:

```javascript
// in open-sse/handlers/chatCore.js
export function applyLoopGuard(translatedBody, finalFormat, provider, model, log) {
  const loopCheck = detectLoop(translatedBody);
  if (!loopCheck.detected) return translatedBody;
  injectTerminationPrompt(translatedBody, finalFormat);
  // ... append hint ...
  return translatedBody;
}
```

Then `handleChatCore` calls `applyLoopGuard(translatedBody, finalFormat, provider, model, log)` and the test imports `applyLoopGuard` directly. This is cleaner but adds a function to maintain. **YAGNI** unless the test is actually hard to write.

### Skipped tests — leave skipped for now

`tests/unit/kimi-max-tokens.test.js` and `tests/unit/kimi-nvidia-hardening.test.js` are `.skip`. Do **not** un-skip them as part of Patches 1-3. They cover Patch 4 (max_tokens clamp) and the executor-side hardening that was reverted. Un-skip only when Patch 4 lands.

## Phase 2 — Manual smoke test

Requires a Kimchi API key. Set it in `.env.local` or via the dashboard.

### Smoke test 1 — K2.7 first-turn without tools (Screenshot 2)

**Goal**: Verify the termination prompt now fires and the model summarizes instead of emitting intent-as-prose.

```bash
curl -X POST http://localhost:3003/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kimchi/kimi-k2.7",
    "messages": [{"role": "user", "content": "cek apakah ada project bernama 9routes di direktori ini"}],
    "stream": false
  }'
```

**Expected**:

- Response comes back in < 60s.
- `choices[0].message.content` contains either a clear "I cannot list directory contents in this environment" or a structured `tool_calls` array, **not** prose describing an intent.
- No 5xx error.

**If the response still looks like screenshot 2**: The termination prompt is firing but the model is ignoring it. Check the request log to confirm the prompt was injected. Look for the log line `TERMINATION kimchi/kimi-k2.7 | openai`.

### Smoke test 2 — K2.6 multi-turn loop (Screenshot 1)

**Goal**: Verify `detectLoop` catches the planning loop and the hint nudges the model.

This is harder to script — you need a real agentic loop. The simplest path:

1. Open the dashboard, route to `kimchi/kimi-k2.6`.
2. Send: "List all files in the current directory and summarize the project structure."
3. Watch for the response. If it starts with multiple "I need to read…" lines, that's the loop.
4. Send a follow-up message. The follow-up should trigger loop detection on the third identical tool call.
5. Verify the response terminates with a summary.

**Expected**: Either the model answers correctly on the first try (best case — Patch 1's termination prompt is enough) or it loops once and then summarizes after the hint is injected.

**If the model still loops indefinitely**: The hint is not strong enough. Consider:

- Increasing hint specificity: add "You have done this 3 times. STOP. Output your answer as plain text now."
- Or: hard-cap `max_iterations` at the executor level — out of scope for this fix.

### Smoke test 3 — NVIDIA Kimi (Screenshot 3)

**Goal**: Verify Patch 4 (or pre-existing behavior) prevents empty responses.

```bash
curl -X POST http://localhost:3003/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/moonshotai/kimi-k2.6(high)",
    "messages": [{"role": "user", "content": "lanjutkan"}],
    "stream": false
  }'
```

**Before Patch 4**: Likely empty `choices[0].message.content` with `finish_reason: "length"` or `"stop"`.

**After Patch 4**: Either a non-empty response (best case) or a clear 4xx error from NIM explaining the cap. Either is acceptable — a clear error is better than an empty 11.9s hang.

## Phase 3 — Regression checks

### Existing tests that should NOT change

```bash
pnpm test tests/translator/thinking-unified.test.js
pnpm test tests/unit/termination-prompt.test.js
pnpm test tests/unit/loop-guard.test.js
pnpm test tests/unit/dynamic-tool-choice.test.js
pnpm test tests/unit/reasoning-content-nvidia.test.js
```

All should remain green. None of these tests exercise `chatCore.js` end-to-end (they're isolated to the helper modules), so Patches 1-3 don't affect them.

### Other provider smoke tests

Run a single curl against three different providers to ensure no regression:

```bash
# Claude (non-Kimi, non-reasoning)
curl -X POST http://localhost:3003/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude/claude-sonnet-4.6", "messages": [{"role": "user", "content": "hi"}]}' | jq

# Kimchi non-Kimi
curl -X POST http://localhost:3003/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "kimchi/smollm2-360m", "messages": [{"role": "user", "content": "hi"}]}' | jq

# NVIDIA non-Kimi
curl -X POST http://localhost:3003/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "nvidia/meta/llama-3.1-8b-instruct", "messages": [{"role": "user", "content": "hi"}]}' | jq
```

**Expected**: All three return 200 with non-empty `content`. The patches only affect `chatCore.js` and `default.js` paths that are gated on Kimi patterns. Non-Kimi models are untouched.

## Phase 4 — Performance / cost

Patches 1-3 add **no measurable cost** at the request level:

- Termination prompt injection: a string concatenation, microseconds.
- Tool protocol prompt injection: same.
- Loop detection: O(N) over `messages` where N is conversation length. For typical agent loops (10-50 messages), this is negligible.

If conversation histories grow to thousands of messages, the sliding-window in `detectSequenceRepeat` becomes O(N²) and may add milliseconds. **Not a concern at current scale** — re-evaluate if agent workflows routinely exceed 1000 messages.

Patch 4 (max_tokens clamp) **reduces** token spend for NVIDIA Kimi users who previously hit NIM's degeneration wall. They will see shorter outputs (max 8192 tokens instead of 32k+) which is the intended behavior.

## Definition of done

- [ ] Patches 1, 2, 3 merged in two commits.
- [ ] `pnpm test tests/unit/loop-guard.test.js` green.
- [ ] `pnpm test tests/unit/termination-prompt.test.js` green.
- [ ] Smoke test 1 (K2.7 first-turn) returns a clear non-prose response.
- [ ] Smoke test 2 (K2.6 multi-turn) terminates with a summary.
- [ ] Three non-Kimi provider smoke tests all return 200 with content.
- [ ] No regressions in `thinking-unified.test.js`, `dynamic-tool-choice.test.js`, `reasoning-content-nvidia.test.js`.
- [ ] Commit messages capture the *why*, not just the *what* (see [`04-git-evidence.md`](./04-git-evidence.md) §"Lessons for the next patch").

If any of the above fails, **stop and investigate**. Do not mark the task complete based on assumption.
