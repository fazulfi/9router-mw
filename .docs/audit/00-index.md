# Kimi Reasoning Loop Audit — Index

> **Status**: Diagnostic complete. Fixes not yet applied.
> **Scope**: Kimi K2.6 & K2.7 on Kimchi provider (primary) and NVIDIA NIM provider (secondary, same symptoms).
> **Audience**: Next agent who will write the patch.

## What's wrong

Reasoning-mode Kimi variants enter degenerate states when used through 9router:

| Screenshot | Provider/Model | Symptom | Time |
|---|---|---|---|
| 1 | `kimchi/kimi-k2.6` | Overthinking loop ("I need to read the key files…" × N) without progressing to a tool call | 2m 23s |
| 2 | `kimchi/kimi-k2.7` | Paraphrases user intent ("search for 9routes") then stops with `finish_reason: stop` — no tool call emitted | 3.3s |
| 3 | `nvidia/moonshotai/kimi-k2.6(high)` | Returns empty content immediately; never produces an output token | 11.9s |
| — | `nvidia/moonshotai/kimi-k2.7` | Same — stops immediately while still in thinking | 11.9s |

## Where to read

Read in this order. Each doc is short, total ≈ 30 min.

1. [`01-symptoms.md`](./01-symptoms.md) — what users see (2 min)
2. [`02-root-cause.md`](./02-root-cause.md) — why it happens (10 min)
3. [`03-code-state.md`](./03-code-state.md) — current code, line by line (10 min)
4. [`04-git-evidence.md`](./04-git-evidence.md) — what previous commits tried (5 min)
5. [`05-fix-plan.md`](./05-fix-plan.md) — exact diffs to apply (5 min)
6. [`06-test-plan.md`](./06-test-plan.md) — how to verify before merging (3 min)
7. [`07-handoff.md`](./07-handoff.md) — checklist before you close the task (2 min)

## TL;DR for the impatient

Three patches, one file, ~15 lines:

1. **`open-sse/handlers/chatCore.js:200`** — drop the `tools.length > 0` gate so the termination prompt also fires on first-turn queries (K2.7 screenshot 2).
2. **`open-sse/handlers/chatCore.js`** — import `detectLoop` from `../utils/loopGuard.js` and wire it after translation; if a loop is detected, append the loop hint to the last user/tool message and inject the termination prompt (K2.6 screenshot 1).
3. **`open-sse/utils/loopGuard.js`** — already exists, already tested, not currently imported anywhere in the chat path. Just wire it.

Then run `pnpm test tests/unit/loop-guard.test.js` and a manual smoke test against `kimchi/kimi-k2.6` with a multi-turn agent task.

**Skip**: max_tokens clamp for Kimchi (no evidence of drain on Kimchi — the NVIDIA clamp exists for a different reason: NIM-side degeneration, not 9router). Capabilities changes. reasoning_content scope change.

See [`05-fix-plan.md`](./05-fix-plan.md) for diffs.
