# 07 — Handoff Checklist

Use this as your closing checklist before marking the task complete. Every box must be checkable, or the task is not done.

## Pre-flight

- [ ] Read [`01-symptoms.md`](./01-symptoms.md) so you understand what users see.
- [ ] Read [`02-root-cause.md`](./02-root-cause.md) so you understand why each symptom happens.
- [ ] Read [`03-code-state.md`](./03-code-state.md) so you know exactly which lines to touch.
- [ ] Skim [`04-git-evidence.md`](./04-git-evidence.md) — especially the "Lessons for the next patch" section. Do not repeat the mistakes of `3dd7a9e5`.
- [ ] Read [`05-fix-plan.md`](./05-fix-plan.md) — the patches and their order.
- [ ] Read [`06-test-plan.md`](./06-test-plan.md) — what to verify.

## Files you will touch

| File | Change | Lines |
|---|---|---|
| `open-sse/handlers/chatCore.js` | Drop `tools.length > 0` gate (×2), wire `detectLoop` | ~200-220 + 1 import |
| `tests/unit/termination-prompt.test.js` | Add 1 test for tool-protocol no-tools case | +5 |
| `tests/unit/loop-guard-wiring.test.js` | New file | +30-50 |

**Optional follow-up** (separate ticket):

| File | Change | Lines |
|---|---|---|
| `open-sse/executors/default.js` | Add max_tokens clamp for NVIDIA Kimi | +5 |
| `tests/unit/kimi-max-tokens.test.js` | Un-skip the 4 tests | -1 per `.skip` |

## Files you will NOT touch

These were tempting during investigation but the audit confirms they are not the cause:

- `open-sse/rtk/terminationPrompt.js` — the prompt text and format-specific injectors are correct.
- `open-sse/utils/loopGuard.js` — the detector is correct, tested, and not in the active path.
- `open-sse/utils/reasoningContentInjector.js` — scope may be too narrow for some edge cases but YAGNI until measured.
- `open-sse/translator/concerns/thinkingUnified.js` — `case "kimi":` is correct.
- `open-sse/translator/concerns/paramSupport.js` — Kimchi sampling-knob strip is correct.
- `open-sse/providers/capabilities.js` — Kimi entries are correct (and the user explicitly rejected the idea of changing `thinkingFormat`).
- `open-sse/providers/registry/kimchi.js` — transport config is correct.

If you find yourself wanting to modify any of these, stop and re-read [`02-root-cause.md`](./02-root-cause.md). Then re-read [`04-git-evidence.md`](./04-git-evidence.md) §"`c76c9105` — what it missed".

## Commit message template

```
fix(kimi): <one-line summary>

<body: what was wrong, what the patch does, why>

Symptom: <link to screenshot description or paste verbatim>
Root cause: <file:line> — <one sentence>
Fix: <file:line> — <one sentence>
Test: <which tests pass>

Refs: AUDIT-05-fix-plan.md, AUDIT-06-test-plan.md
```

Example for Patch 1+2:

```
fix(kimi): drop tools.length gate so termination fires on first turn

The termination prompt was only injected when translatedBody.tools
was non-empty. On a first-turn query with no tools declared, the
model had no anchoring instruction to summarize instead of emitting
intent-as-prose. K2.7's prose-then-stop pattern (screenshot 2) is
the visible failure.

Drop the gate. The prompt content ("STOP calling tools and provide
your final answer") is useful even when no tools are declared.
injectTerminationPrompt is idempotent so multi-turn conversations
that later add tools will not see a duplicate prompt.

Same logic applies to injectToolProtocolPrompt — its no-tools
fallback already produces a useful hint when toolNames is empty.

Symptom: kimchi/kimi-k2.7 first-turn returns "I will search for…"
         as prose, finish_reason=stop, no tool_calls emitted.
Root cause: open-sse/handlers/chatCore.js:195,200 — gated on
            tools.length > 0.
Fix: open-sse/handlers/chatCore.js:195,200 — drop the gate.
Test: tests/unit/termination-prompt.test.js (unchanged, still green)

Refs: .docs/audit/05-fix-plan.md
```

Example for Patch 3:

```
fix(kimi): wire loopGuard in chatCore to catch planning loops

loopGuard.js exists, is tested (9 passing tests), but was never
imported into the active chat path. K2.6 overthinking loops
(screenshot 1) — model emits repeated "I need to read…" without
ever calling a tool — go undetected.

After translation, run detectLoop on the translated body. If a
loop is detected, append the hint to the last user/tool message
and inject the termination prompt regardless of the tools gate.

Symptom: kimchi/kimi-k2.6 emits "I need to read…" 5+ times then
         aborts after 2 minutes with no tool call.
Root cause: open-sse/handlers/chatCore.js — detectLoop never called.
Fix: open-sse/handlers/chatCore.js — import + invoke detectLoop
     after translation, before executor dispatch.
Test: tests/unit/loop-guard.test.js (unchanged, still green).
      New: tests/unit/loop-guard-wiring.test.js (integration test).

Refs: .docs/audit/05-fix-plan.md
```

## Success criteria

The task is **done** when ALL of the following are true:

- [ ] Patches 1, 2, 3 are applied in separate commits (or combined 1+2 as the audit suggests).
- [ ] `pnpm test tests/unit/loop-guard.test.js` reports 9 passing.
- [ ] `pnpm test tests/unit/termination-prompt.test.js` reports all passing (now 10 with the new test).
- [ ] `pnpm test tests/unit/loop-guard-wiring.test.js` reports all passing (new file).
- [ ] `pnpm test tests/translator/thinking-unified.test.js` reports all passing (no regression).
- [ ] Manual smoke test 1 (K2.7 first-turn) returns a non-prose response.
- [ ] Manual smoke test 2 (K2.6 multi-turn) terminates within 60s with a summary.
- [ ] Three non-Kimi provider smoke tests all return 200 with content.
- [ ] Commit messages include the *why*, not just the *what*.

The task is **not done** if any of the following are true:

- [ ] You marked it complete based on "the tests should still pass" without running them.
- [ ] You marked it complete based on "the patch looks correct" without smoke-testing.
- [ ] You reverted a patch because it broke something instead of investigating.
- [ ] You added patches 1-3 but did not write the integration test for Patch 3.
- [ ] You claimed "loopGuard is wired" without importing it (this was the failure mode of `3dd7a9e5` — the infra was added but never connected).

## If you get stuck

- **Termination prompt still not firing on K2.7**: Check that `provider === "kimchi"` (not `"ki"`) is reaching `handleChatCore`. The `alias` field is `"ki"` (see `open-sse/providers/registry/kimchi.js:4`) but `provider` should be the full `"kimchi"` id. If you're seeing `provider === "ki"`, the upstream resolved the alias too early — check `parseModel` in `open-sse/services/model.js`.
- **Loop detector never fires**: Check that `translatedBody.messages` actually contains the assistant `tool_calls` arrays. The OpenAI translator (`open-sse/translator/request/openai-to-openai.js` if it exists, or the inline case) should preserve them. If it doesn't, the loop detector sees no tool calls and returns `not detected`.
- **Tests pass but smoke test fails**: Likely the request is not routing to Kimchi. Check the request log to see which executor ran. The log line `REQUEST KIMCHI | kimi-k2.6 | N msgs` confirms the right path.

## Escalation

If after applying Patches 1-3 the symptoms persist, escalate to a human with:

1. The full request log for one failing call (look for `reqLogger.logRawRequest` output).
2. The model output (if any) verbatim.
3. The `messages` array of the request as 9router sent it to upstream.
4. The upstream response (status, headers, body).

Do not escalate without those four artifacts. They are the minimum needed to diagnose further.

## Closing notes

This audit covers Kimi K2.6/K2.7 on Kimchi (primary) and NVIDIA NIM (secondary). It does **not** cover:

- Codebuddy-cn Kimi (different provider, different `thinkingFormat`).
- `kimi-coding` OAuth provider (different auth path).
- Non-Kimi Kimchi models (`minimax-*`, `smollm2-*`, `nemotron-*`).

If the symptoms appear on those models, the audit is not authoritative and a new investigation is needed.

The audit was written on 2026-06-25 based on code state at HEAD. If the codebase has moved on (new commits, refactors), re-verify the line references in [`03-code-state.md`](./03-code-state.md) before applying patches.
