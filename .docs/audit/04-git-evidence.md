# 04 — Git Evidence

Previous commits that tried to address Kimi reasoning issues. Read this **before** writing a new patch — don't repeat their mistakes.

## `c76c9105` — fix(kimi): harden 2.6/2.7 thinking + add termination prompt

**Author**: Vanszs, 2026-06-25
**Files**: 8 changed, +57 / -45
**Key changes**:

1. Added `needsTerminationPrompt()` helper in `chatCore.js` matching `kimi-k2.6` / `kimi-k2.7`.
2. Wired it to call `injectTerminationPrompt` after translation.
3. Added explicit Kimi overrides in `capabilities.js` for `kimchi:` and `kimi:` providers.
4. Changed `case "kimi":` to send `reasoning_effort: "none"` instead of `thinking: { type: "disabled" }` for the off case (upstream was ignoring the latter).
5. Added `paramSupport` rules to strip sampling knobs Kimchi rejects.

**Test changes**:

- `tests/translator/thinking-unified.test.js`: added Kimi off → `reasoning_effort: "none"` case.
- `tests/unit/termination-prompt.test.js`: added `needsTerminationPrompt` match tests.

**What it fixed**:

- Off-thinking now actually disables thinking on Kimi upstream.
- Termination prompt fires when K2.6/K2.7 are running with `tools.length > 0`.

**What it missed**:

- The termination prompt is gated on `tools.length > 0`. First-turn queries without tools (screenshot 2) skip it.
- The tool-protocol prompt (also gated on `tools.length > 0`) was never updated.
- No loop detector wiring.

## `3dd7a9e5` — fix(nvidia/kimi-k2.6): clamp max_tokens to prevent NIM degeneration/loop

**Author**: Vanszs, 2026-06-04
**Files**: 15 changed, +948 / -186
**Key changes**:

1. Added `open-sse/utils/loopGuard.js` (112 lines) with `detectLoop` and supporting helpers.
2. Added `open-sse/rtk/terminationPrompt.js` (134 lines) with `injectTerminationPrompt` and `injectToolProtocolPrompt`.
3. Added `max_tokens` clamp in `open-sse/executors/default.js` for NVIDIA Kimi (clamp to 8192 ceiling).
4. Added `getModelAgenticConfig` and `AGENTIC_CONFIG` to `open-sse/config/providerModels.js` for per-model loop-guard config.
5. Added error handling tweaks in `open-sse/utils/error.js`.
6. Wrote a `plan.md` (310 lines) documenting the investigation.

**Test changes**:

- `tests/unit/loop-guard.test.js` — new file, 86 lines, all passing.
- `tests/unit/kimi-max-tokens.test.js` — new file, 52 lines, all `.skip`.
- `tests/unit/kimi-nvidia-hardening.test.js` — refactored, still all `.skip`.
- `tests/unit/dynamic-tool-choice.test.js`, `tests/unit/termination-prompt.test.js`, `tests/unit/reasoning-content-nvidia.test.js` — new or modified.

**Critical observation**: The commit message itself says:

> "Termination-prompt/loop-guard infra kept but disabled."

The infrastructure was added but the gate (`agenticConfig.loopGuard`) defaults to `false`. The active code path **does not** invoke `detectLoop`. The `loopGuard` function exists, is tested, and is unused.

**Why the infrastructure is "kept but disabled"**: The author found that actively intervening mid-conversation (injecting the hint, forcing a stop) caused more problems than it solved in some scenarios. The clamp and the fail-fast on response side were the safer interventions. Loop guard remained as a known-available escape hatch for future use.

**What it fixed**:

- NIM degeneration on `kimi-k2.6` with large `max_tokens`.
- Fail-fast on `repetition_detected` so combo/fallback chains can re-route.

**What got reverted or removed in later commits**:

- The wire-up of `detectLoop` in `chatCore.js` — see the diff between `3dd7a9e5` and the current `chatCore.js`. The wire-up was present in the commit (lines 144-176 of the diff) but is not in the current file.
- `getModelAgenticConfig` and `AGENTIC_CONFIG` — no remaining references in `open-sse/config/`.
- The `max_tokens` clamp in `default.js` — gone. Tests are `.skip`'d.

The infrastructure files survived (`loopGuard.js`, `terminationPrompt.js`, the tests). The runtime wiring did not.

## `8b844655` — fix: reject kimi tool mode on nvidia

**Author**: Vanszs, 2026-06-04
**Files**: 2 changed, +65 / -26

Predecessor to `3dd7a9e5`. Added tool-mode rejection for NVIDIA Kimi in the executor. Tests in `kimi-nvidia-hardening.test.js` were first added here.

## `96a9a2b3` — fix: sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)

Different concern — sanitizes tool argument shape to prevent non-Anthropic clients from producing JSON the upstream rejects. Useful as a reference for "what does an interop loop look like" but unrelated to our K2.6/K2.7 planning-loop problem.

## `e03f2942` — feat(providers): retry transient body errors + batch delete UI

`open-sse/executors/default.js` gained a `_peekTransientBodyError` retry loop. This is the "5 retries on `Hosted_vllmException` / `Server disconnected`" mechanism. Worth noting because **the NVIDIA Kimi empty-body response is not retried by this loop** — `_peekTransientBodyError` checks for specific error patterns in the body, and an empty body matches none of them.

If we want to retry on empty body, we'd need to either:

- Add an empty-body check before `_peekTransientBodyError`, or
- Treat empty body as a 502 in `trackPendingRequest`.

**Not part of this fix** — but flagged for follow-up.

## `9ab14e77` — fix(combo/fusion): flatten tool history in panel calls to prevent 503

Combo/fusion strategies used to send nested tool message history to upstream Kimi which 503'd. Flattened. Unrelated to K2.6/K2.7 reasoning but shows the pattern: upstream Kimi has many edge cases.

## `c24efe80` — fix(kiro): enable multi-endpoint failover for GenerateAssistantResponse

Kiro path. Not Kimi.

## Lessons for the next patch

1. **Don't re-add the `max_tokens` clamp to the executor without verifying NIM still has the same degeneration behavior.** The original clamp existed in `3dd7a9e5` and was reverted. There may have been a reason — wrong model match, wrong ceiling, side-effect on non-Kimi NVIDIA models. Re-introduce with the same `(provider === "nvidia" && /kimi-k2\.(6|7)/i.test(model))` guard.

2. **Don't force-inject termination prompts for every Kimi call without thinking through the cost.** `3dd7a9e5` left the wire-up disabled by default for a reason. The minimum-disruption path is:
   - Drop the `tools.length > 0` gate (so prompt fires for K2.7 screenshot 2).
   - Wire `detectLoop` so it only fires when a loop is actually detected (no proactive nudge).
   - Append the loop hint in-place rather than as a new top-level message.

3. **Don't change `thinkingFormat: "kimi"` to anything else.** The user explicitly pushed back on this during our conversation. It is correct.

4. **The infrastructure tests are your friend.** `loop-guard.test.js` is green. Any patch that wires `detectLoop` should not break those tests. Run them.

5. **Document the why.** Each of these commits has a clear rationale in the body. When you write the fix commit, capture why the gate was relaxed, why the loop hint is appended (not prepended), and why we didn't clamp `max_tokens` for Kimchi.
