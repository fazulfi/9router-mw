# Upstream Cherry-Pick Safety Audit

**Repo:** `/media/DiskE/Code/9router-new` (`Vanszs/VansRouter`)  
**Upstream:** `decolua/9router` (remote `upstream`)  
**Audited range:** `origin/main..HEAD` (commits not yet pushed to our `main`)  
**Date:** 2026-06-28

## Scope & Method

I looked for upstream-derived commits already present in our tree using:

- `git log --all --grep="cherry picked from commit" --oneline` (4 literal cherry-picks).
- `git log origin/main..HEAD --format="%H %s"` (commits ahead of our remote `main`).
- Cross-checked each subject against `upstream/master` to confirm the upstream origin.
- Inspected `git show --stat` and the actual diffs for commits that touch the custom VansRoute files listed below.

## Count Note: 18 requested vs 21 found

`origin/main..HEAD` contains **22 commits**: one VansRoute build fix (`f9752e92`) plus **21 upstream-derived commits**. Three of those 21 are non-functional (version bump, Docker chore, i18n-only), so the remaining **18 functional upstream cherry-picks** are the ones audited below.

| Excluded commit | Upstream hash | Why excluded |
|-----------------|---------------|--------------|
| `d631078c` | `cce47dd8` | Version bump `# v0.5.12` only; no code conflict. |
| `2189698d` | `c7933de7` | Pure `docker-compose.yml` chore; no app-code impact. |
| `6ca63494` | `77b38564` | `zh-CN` i18n literals only; no custom-logic impact. |

## Custom VansRoute Logic That Must Be Preserved

1. **Kimi tool parser** — `open-sse/utils/kimiToolParser.js:236` (`normalizeKimiToolCalls`), consumed in `open-sse/handlers/chatCore/streamingHandler.js`.
2. **NVIDIA NIM stream coercion** — `open-sse/handlers/chatCore.js:39` (`isNvidiaKimiStreamCoerce`).
3. **OpenAI tool-calls chunk builder** — `open-sse/utils/stream.js:23` (`buildOpenAIToolCallsChunk`).
4. **AgentRouter forceStream + stream_options strip** — `open-sse/providers/registry/agentrouter.js:89` (`forceStream: true`) and `open-sse/translator/concerns/paramSupport.js` (`stripUnsupportedParams`).
5. **Translator custom prefix resolution** — `src/app/api/translator/translate/route.js` (uses `getModelInfo` after `cff7e4fb`).
6. **Resilience engine** — `src/sse/handlers/chat.js:289,304,430-432` (early-EOF retry, cooldown), `open-sse/utils/classify429.js`, `open-sse/utils/cooldownRetry.js`, `open-sse/utils/error.js:146` (`X-VansRoute-Selected-Connection-Id`).
7. **ACL providers dialog fix** — `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` + `/api/providers` noAuth merge.
8. **API key requirement logic** — `src/lib/db/repos/settingsRepo.js:20-21` (`requireApiKey`, `allowRemoteNoApiKey`).

## Already-merged upstream cherry-picks — 18 functional commits

## Summary Table — 18 Functional Upstream Cherry-Picks

| Our hash | Upstream hash | Title | Decision | Custom feature at risk |
|----------|---------------|-------|----------|------------------------|
| `6e998807` | `639f1204` | fix(antigravity): retry transient upstream failures | **ADOPT** | None |
| `21958e03` | `8ac631d6` | fix(ssrf): block IPv6-mapped IPv4 addresses | **ADOPT** | None |
| `d28b4697` | `a4f44e3e` | feat(kiro): add external_idp CLIProxyAPI import | **ADOPT** | None |
| `c0da13de` | `d4d11357` | fix(headroom): translate openai-responses input through OpenAI for compression | **ADOPT** | None |
| `3f6a666a` | `520f5049` | fix(models): show custom provider models in combo picker | **ADOPT** | None (touches `ModelSelectModal`, not `EndpointPageClient` ACL dialog) |
| `8aaf6731` | `d1e98d9a` | fix(codebuddy): only send reasoning params when client requests reasoning | **ADOPT** | None |
| `adab46cc` | `e544bfce` | fix(codex): preserve Responses text format | **ADOPT** | None |
| `ef7edc88` | `6e9c7bf4` | fix(auth): avoid stale redirects after auth changes | **ADOPT** | None (does not touch `settingsRepo.js` defaults) |
| `cff7e4fb` | `90b336d9` | fix(translator): resolve custom provider prefix in debug endpoint | **ADOPT** | #5 Translator custom prefix resolution |
| `d9b4b63a` | `d8c2298d` | fix(security): patch 5 vulnerabilities from security audit | **ADOPT** | None (touches `usageRepo/outboundProxy/manager`, not resilience core) |
| `a5375e3b` | `f46811c7` | fix(gemini): validate native model id to block path traversal | **ADOPT** | None |
| `00bc1287` | `4d9da5db` | fix: support Kiro IDC (organization) token import | **ADOPT** | None |
| `36120f9f` | `644bff4c` | feat: add bulk delete for provider connections | **ADOPT** | None |
| `e7f631d0` | `2deacf69` | fix(token-saver): full width card layout | **ADOPT** | None |
| `023ed166` | `ce844899` | fix(tts): resolve Gemini TTS models from catalog | **ADOPT** | None |
| `ffd7ebe2` | `c4f80d30` | fix provider thinking compatibility | **HYBRID** | AgentRouter/GLM-5.2 reasoning path (pending Ferment 4 leak fix) |
| `1f8cf628` | `4a54824f` | fix(param-support): handle strip rules without match/drop | **ADOPT** | #4 AgentRouter stream_options strip rules |
| `165e6146` | `3a866fe1` | fix(reasoning): preserve effort through Codex translations | **ADOPT** | AgentRouter/GLM-5.2 reasoning path (monitor) |

## Per-Commit Rationale

- **`6e998807` / `639f1204`** — Adds retry hooks inside `open-sse/executors/antigravity.js`. Does not modify the resilience core in `src/sse/handlers/chat.js`, `classify429.js`, or `cooldownRetry.js`. Safe to keep.
- **`21958e03` / `8ac631d6`** — One-line SSRF guard addition in `src/shared/utils/ssrfGuard.js`. No overlap with custom features.
- **`d28b4697` / `a4f44e3e`** — New Kiro Microsoft-SSO import flow (`kiroExternalIdp.js`, `KiroAuthModal.js`). Purely additive.
- **`c0da13de` / `d4d11357`** — Headroom token-saver fix in `open-sse/rtk/headroom.js`. Does not touch Kimi/AgentRouter/resilience logic.
- **`3f6a666a` / `520f5049`** — Updates `ModelSelectModal.js` to include custom provider models. The ACL providers dialog fix lives in `EndpointPageClient.js`; no collision.
- **`8aaf6731` / `d1e98d9a`** — CodeBuddy reasoning opt-in. Confined to `open-sse/executors/codebuddy-cn.js`.
- **`adab46cc` / `e544bfce`** — Codex Responses text-format preservation. Confined to `open-sse/executors/codex.js`.
- **`ef7edc88` / `6e9c7bf4`** — Adds `Cache-Control: no-store` to login/logout responses and replaces Next.js router navigation with full-page reload. `settingsRepo.js` `requireApiKey`/`allowRemoteNoApiKey` defaults are untouched.
- **`cff7e4fb` / `90b336d9`** — Replaces `parseModel` with `getModelInfo` in the translator debug endpoint so custom provider prefixes resolve the same way as runtime chat. This directly improves custom feature #5 and is already covered by `tests/unit/translator-custom-prefix.test.js`.
- **`d9b4b63a` / `d8c2298d`** — `pnpm audit` fixes plus hardening in `usageRepo.js`, `outboundProxy.js`, and `src/mitm/manager.js`. No changes to `src/sse/handlers/chat.js` or the cooldown/429/selected-connection logic.
- **`a5375e3b` / `f46811c7`** — Validates Gemini model IDs to block path traversal in `src/app/api/v1beta/models/[...path]/route.js`. No custom-feature overlap.
- **`00bc1287` / `4d9da5db`** — Kiro IDC token import support. Touches Kiro OAuth routes only.
- **`36120f9f` / `644bff4c`** — Bulk-delete UI for provider connections. Dashboard-only.
- **`e7f631d0` / `2deacf69`** — Token Saver dashboard layout. UI-only.
- **`023ed166` / `ce844899`** — Gemini TTS catalog resolution. TTS-only.
- **`ffd7ebe2` / `c4f80d30`** — Changes `thinkingUnified.js` and `open-sse/translator/formats/claude.js` (DeepSeek thinking placeholder, Gemini thinking-level clamping). **Hybrid** because it changes the Claude-format request path that AgentRouter uses. Adopt the upstream logic, but verify the pending Ferment 4 GLM-5.2 reasoning-leak fix still strips/wraps reasoning tokens before delivering to the client.
- **`1f8cf628` / `4a54824f`** — Defensive fix in `paramSupport.js`: treat missing `rule.match` as provider-wide and missing `rule.drop` as empty array. Our AgentRouter `forceStream` + `stream_options` strip rules keep their explicit `match`/`drop`, so this only prevents crashes for other providers. Safe.
- **`165e6146` / `3a866fe1`** — Preserves `reasoning_effort` across Codex tool-result turns and maps it in `claude-to-openai.js`. AgentRouter uses Claude target, not Codex, but reasoning propagation is adjacent to the GLM-5.2 reasoning issue. Adopt and monitor; no override of custom logic.

## Non-Upstream Commit in the Same Range

- **`f9752e92`** — `fix(build): Windows EPERM, webpack bun:sqlite/node:sqlite, missing deps, profile use-client` is **VansRoute-only** (authored by Vanszs). It restores the 5 missing resilience test files and fixes the Windows build. Decision: **KEEP CUSTOM** — required for our fork and must not be reverted.

## Older Upstream Commits Already in `origin/main`

Earlier merge commits (`12ca2b63`, `5894e57b`, `88ab86b1`, `889de4b0`, etc.) already brought upstream changes that touched custom features. Those were resolved at merge time and are part of the current `origin/main` baseline; they are not in the `origin/main..HEAD` audit scope. No action needed for this push.

## Verdict

All 18 functional upstream cherry-picks in `origin/main..HEAD` are safe to push as-is, with one marked **HYBRID** (`ffd7ebe2`) because it sits on the same Claude-format reasoning path as the pending GLM-5.2 leak fix. No custom VansRoute logic is overwritten by these commits.
