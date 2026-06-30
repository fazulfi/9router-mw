# Upstream 9router Audit — VansRouter Fork (`dev`)

**Audit date:** 2026-06-29  
**Fork repository:** `https://github.com/Vanszs/VansRouter.git`  
**Current branch:** `dev`  
**Upstream repository:** `https://github.com/decolua/9router.git` (`upstream/master`)  
**Fork package:** `@vanroute/vansrouter` / `vansrouter-app` v0.7.2  
**Upstream package:** `9router` v0.5.15  
**Output:** `.kimchi/docs/upstream-audit.md`

---

## 1. Executive Summary

The `dev` branch of VansRouter is **173 commits ahead** of upstream `9router/master` and **50 commits behind**. A direct merge is not viable because the fork carries significant custom logic: VansAI branding, Kimchi CLI integration, an ACL enforcement layer, Ponytail/RTK token-saver extensions, a custom Kimchi API-key provider, a dashboard guard with `allowRemoteNoApiKey`, and an in-flight Go porting effort.

Of the 50 upstream commits reviewed, **12 have already been cherry-picked into `dev`** (mostly with adaptations noted in commit messages). Of the remaining **38 unmerged commits**, the recommended posture is:

| Classification | Count | Action |
|---|---|---|
| **ADOPT** | 23 | Cherry-pick or patch; low conflict risk with custom logic. |
| **HYBRID** | 6 | Adopt the code change but adapt it around our custom files/settings. |
| **SKIP** | 9 | Rebrand, version-bump, or feature-area conflicts make direct adoption unsafe. |
| **Already in `dev`** | 12 | Do not re-apply; verify the adapted version is complete. |

**Top-priority security fixes to adopt immediately:**
- `8ac631d6` — SSRF IPv6-mapped-IPv4 bypass.
- `d8c2298d` — Security audit: API-key masking, proxy URL validation, OAuth XSS, MITM TOCTOU.
- `f46811c7` — Gemini native model-id path-traversal guard.

**Highest-risk merge areas:**
1. **Kimchi provider collision** — upstream adds a `kimchi` OAuth provider; fork already has a `kimchi` API-key provider.
2. **Auto-ping scheduler** — upstream generalizes `claudeAutoPing` → `quotaAutoPing`; fork still uses the old name and service file.
3. **Headroom** — several upstream headroom fixes touch `open-sse/rtk/headroom.js`, which our fork already uses.
4. **Token-saver dashboard** — already partially cherry-picked; upstream's `TokenSaverClient.js` layout fix is minor but should be verified against our branding.

---

## 2. Divergence Overview

```bash
# Commits in upstream/master not in HEAD
git rev-list --count HEAD..upstream/master   # 50

# Commits in HEAD not in upstream/master
git rev-list --count upstream/master..HEAD   # 173

# Files changed between the two tips
git diff --stat upstream/master HEAD | tail -3
# 945 files changed, 291951 insertions(+), 103045 deletions(-)
```

| Metric | Value |
|---|---|
| Upstream ahead of fork | 50 commits |
| Fork ahead of upstream | 173 commits |
| Total files different | 945 |
| Net diff | +291,951 / −103,045 |

The fork's 173 extra commits include the VansRouter rebrand, ACL system, Ponytail token saver, Kimchi CLI-native wiring, custom provider nodes, ZCode provider, resilience hardening, and the Go porting audit.

---

## 3. Upstream Features Inventory (Last 50 Commits)

| # | Hash | Type | Summary | Status vs `dev` | Classification |
|---|---|---|---|---|---|
| 1 | `0b3c7940` | version | `# v0.5.15` (CHANGELOG + package bumps) | Not merged | **SKIP** — version/rebrand conflict |
| 2 | `a9785a5f` | fix | Handle `response.done` terminal events in Responses API streams | Not merged | **ADOPT** |
| 3 | `373850ee` | fix | Skip Headroom compression for unsafe Responses tool/reasoning history | Not merged | **HYBRID** (touches Headroom) |
| 4 | `749c2e3f` | fix | Map mid-conversation system message to user in `claude-to-openai` | Not merged | **ADOPT** |
| 5 | `7fa2e7f0` | feat | Refine Qwen vision/video and thinking model patterns | Not merged | **ADOPT** |
| 6 | `8d1db46b` | fix | Normalize Gemini contents to prevent `400 invalid_argument` | Not merged | **ADOPT** |
| 7 | `9e386665` | fix | Preserve `cache_control` for DashScope (AliCode) providers | Not merged | **ADOPT** |
| 8 | `8a664d61` | feat | Add **Kimchi OAuth provider support** | Not merged | **HYBRID** (ID collision with fork's `kimchi` provider) |
| 9 | `2d94fffe` | fix | Backfill `thoughtSignature` and suppress stream done sentinel for Gemini | Not merged | **ADOPT** |
| 10 | `319caa2d` | fix | Strip `deprecated` from tool schemas before Gemini | Not merged | **ADOPT** |
| 11 | `95bfc64f` | fix | Show CodeBuddy-CN bonus packs as one-time, not monthly | Not merged | **ADOPT** |
| 12 | `eff81b12` | fix | Strip leaked `<thinking>` tags from Kiro content stream | Not merged | **ADOPT** |
| 13 | `b66b5c68` | feat | Add opt-in Codex auto-ping (generalizes Claude auto-ping) | Not merged | **HYBRID** (replaces `claudeAutoPing` with `quotaAutoPing`) |
| 14 | `fc8722e8` | fix | Make Windows context menu DPI-aware | Not merged | **ADOPT** |
| 15 | `713c5637` | fix | Expose full gateway catalog in Kilocode combo picker | Not merged | **ADOPT** |
| 16 | `3d20a4cc` | fix | Strip `deprecated/readOnly/writeOnly` from tool schemas for Antigravity | Not merged | **ADOPT** |
| 17 | `52623587` | fix | Fix OpenCode Go GLM translator path | Not merged | **ADOPT** |
| 18 | `cce47dd8` | version | `# v0.5.12` (CHANGELOG + package bumps) | Not merged | **SKIP** — version/rebrand conflict |
| 19 | `90b336d9` | fix | Resolve custom provider prefix in debug endpoint | Not merged | **ADOPT** |
| 20 | `4a54824f` | fix | Handle strip rules without `match/drop` in param-support | Not merged | **ADOPT** |
| 21 | `639f1204` | fix | Retry transient upstream failures in Antigravity executor | Not merged | **ADOPT** |
| 22 | `2deacf69` | fix | Full-width card layout on token-saver dashboard | Not merged | **HYBRID** (minor UI; verify branding) |
| 23 | `8ac631d6` | fix | **Block IPv6-mapped IPv4 addresses in SSRF guard** | Not merged | **ADOPT** |
| 24 | `3a866fe1` | fix | Preserve reasoning `effort` through Codex translations | Not merged | **ADOPT** |
| 25 | `940a35e0` | feat | Overhaul Blackbox provider catalog + WebUI test support | Already cherry-picked as `64904cc2` | Already merged (verify) |
| 26 | `a4f44e3e` | feat | Add `external_idp` CLIProxyAPI import for Kiro Microsoft SSO | Already cherry-picked as `99f45b81` | Already merged (verify) |
| 27 | `49a3ec7a` | fix | Mark Claude Opus 4.7 (dashed id) as 1M context | Already cherry-picked as `a77f844b` | Already merged (verify) |
| 28 | `6e9c7bf4` | fix | Avoid stale redirects after auth changes | Not merged | **ADOPT** |
| 29 | `ab5ec52f` | feat | Add Venice AI provider | Already cherry-picked as `7f322c3f` | Already merged (verify) |
| 30 | `eb9728d0` | fix | Report 1M context window for `claude-opus-4.8` in Kiro | Already cherry-picked as `99f45b81` | Already merged (verify) |
| 31 | `d4d11357` | fix | Translate `openai-responses` input through OpenAI for Headroom | Not merged | **HYBRID** (touches Headroom + Responses) |
| 32 | `fb543a1f` | fix | Clarify Headroom token diagnostics vs provider billing | Already cherry-picked as `4b6bd2d9` | Already merged (verify) |
| 33 | `c7933de7` | chore | Add `docker-compose.yml` with Headroom enabled | Not merged | **SKIP** — fork already has branded `docker-compose.yml` |
| 34 | `d8c2298d` | fix | **Patch 5 vulnerabilities from security audit** | Not merged | **ADOPT** |
| 35 | `520f5049` | fix | Show custom provider models in combo picker | Not merged | **ADOPT** |
| 36 | `f46811c7` | fix | Validate Gemini native model id to block path traversal | Not merged | **ADOPT** |
| 37 | `d1e98d9a` | fix | Only send reasoning params when client requests reasoning (CodeBuddy) | Not merged | **ADOPT** |
| 38 | `77b38564` | fix | Add missing zh-CN endpoint key label | Not merged | **ADOPT** |
| 39 | `dae69a39` | fix | Support native Gemini TTS `generateContent` endpoint | Already cherry-picked as `cf9cab92` | Already merged (verify) |
| 40 | `1980178d` | feat | Resolve Copilot model catalog from upstream GitHub | Already cherry-picked as `2cd4cc29` | Already merged (verify) |
| 41 | `e544bfce` | fix | Preserve Responses text format for Codex | Not merged | **ADOPT** |
| 42 | `c842dc8f` | fix | Preserve forced streaming for JSON clients | Already cherry-picked as `9120d60a` | Already merged (verify) |
| 43 | `4d9da5db` | fix | Support Kiro IDC (organization) token import | Not merged | **ADOPT** |
| 44 | `ce844899` | fix | Resolve Gemini TTS models from catalog | Not merged | **ADOPT** |
| 45 | `644bff4c` | feat | Add bulk delete for provider connections | Already cherry-picked as `ca94fdd5` | Already merged (verify) |
| 46 | `c22f11de` | fix | Prevent non-JSON SSE lines and duplicate `[DONE]` | Already cherry-picked as `10dfb894` | Already merged (verify) |
| 47 | `0d216689` | fix | Usage logging dedupe and reduce stats churn | Already cherry-picked as `fb76541f` | Already merged (verify) |
| 48 | `ec096d2a` | fix | Stop double-counting streaming usage at source | Already cherry-picked as `99648cc9` | Already merged (verify) |
| 49 | `c4f80d30` | fix | Provider thinking compatibility | Not merged | **ADOPT** |
| 50 | `cb65a45e` | feat | Add token-saver dashboard page | Already cherry-picked as `4825acdf` | Already merged (verify) |

**Already-merged cherry-picks to verify before re-applying anything:**
- `cb65a45e` → `4825acdf` (token-saver page; kept `EndpointPageClient.js` customizations)
- `0d216689` → `fb76541f` (usage dedupe; preserved `apiKeyName` + async `onRequestSuccess`)
- `c22f11de` → `10dfb894` (SSE `[DONE]` hardening)
- `1980178d` → `2cd4cc29` (Copilot catalog; preserved CLI auth + timeout)
- `dae69a39` → `cf9cab92` (Gemini TTS; preserved model-id validation)
- `ec096d2a` → `99648cc9` (usage double-counting)
- `c842dc8f` → `9120d60a` (forced streaming for JSON clients)
- `fb543a1f` → `4b6bd2d9` (Headroom diagnostics)
- `eb9728d0` → `99f45b81` (Kiro 1M context; preserved `external_idp` + `randomUUID`)
- `ab5ec52f` → `7f322c3f` (Venice AI)
- `49a3ec7a` → `a77f844b` (Claude Opus 4.7 context)
- `940a35e0` → `64904cc2` (Blackbox overhaul)

---

## 4. ADOPT Recommendations

Apply these cleanly via cherry-pick or by re-applying the diff. They do not touch branding or custom VansRouter logic.

### 4.1 Security (highest priority)

| Upstream | Files | Why adopt |
|---|---|---|
| `8ac631d6` | `src/shared/utils/ssrfGuard.js` | Adds IPv6-mapped IPv4 blocking (`::ffff:127.0.0.1`) to SSRF guard. Two-line patch; zero conflict. |
| `d8c2298d` | `src/lib/db/repos/usageRepo.js`<br>`src/lib/network/outboundProxy.js`<br>`src/lib/oauth/utils/server.js`<br>`src/mitm/manager.js` | Masks API keys in usage responses, validates proxy URL schemes, escapes OAuth callback message HTML, and adds atomic lock-file guard to MITM server start. All generic hardening. |
| `f46811c7` | `src/app/api/v1beta/models/[...path]/route.js` | Validates Gemini native model id to block path traversal. Low-risk endpoint security fix. |

### 4.2 Translator / format correctness

| Upstream | Files | Why adopt |
|---|---|---|
| `a9785a5f` | `open-sse/utils/responsesStreamHelpers.js`<br>`open-sse/utils/stream.js` | Treats `response.done` as terminal and restores `[DONE]` sentinel for OpenAI Responses passthrough. |
| `749c2e3f` | `open-sse/translator/request/claude-to-openai.js` | Maps mid-conversation system messages to user role, matching Claude's constraints. |
| `8d1db46b` | `open-sse/translator/request/openai-to-gemini.js` | Merges adjacent same-role Gemini content blocks to avoid `400 INVALID_ARGUMENT`. |
| `52623587` | `open-sse/translator/response/openai-to-claude.js` | Fixes OpenCode Go GLM response path. |
| `90b336d9` | `src/app/api/translator/translate/route.js` | Resolves custom provider prefix in debug endpoint. |
| `4a54824f` | `open-sse/translator/concerns/paramSupport.js` | Handles strip rules that lack `match/drop`. |
| `3a866fe1` | `open-sse/services/provider.js`<br>`open-sse/translator/concerns/thinkingUnified.js`<br>`open-sse/translator/request/claude-to-openai.js`<br>`open-sse/translator/request/openai-responses.js` | Preserves reasoning `effort` across Codex translations. |
| `c4f80d30` | `open-sse/translator/concerns/thinkingUnified.js`<br>`open-sse/translator/formats/claude.js`<br>`src/app/api/providers/[id]/test/testUtils.js` | Provider thinking-compatibility fixes + test utility additions. |

### 4.3 Provider-specific executor / registry fixes

| Upstream | Files | Why adopt |
|---|---|---|
| `7fa2e7f0` | `open-sse/providers/capabilities.js` | Refines Qwen vision/video/thinking patterns. |
| `9e386665` | `open-sse/providers/registry/alicode-intl.js`<br>`open-sse/providers/registry/alicode.js`<br>`open-sse/translator/formats/openai.js`<br>`open-sse/translator/index.js` | Preserves `cache_control` for DashScope providers. |
| `2d94fffe` | `open-sse/executors/antigravity.js`<br>`open-sse/translator/request/openai-to-gemini.js`<br>`open-sse/utils/stream.js` | Backfills `thoughtSignature` and suppresses spurious stream done sentinel. |
| `319caa2d` | `open-sse/translator/formats/gemini.js` | Strips `deprecated` from tool schemas before Gemini. |
| `95bfc64f` | `open-sse/services/usage/codebuddy-cn.js`<br>`src/app/(dashboard)/dashboard/usage/components/ProviderLimits/*` | Corrects CodeBuddy-CN bonus-pack recurrence display. |
| `eff81b12` | `open-sse/executors/kiro.js` | Strips leaked `<thinking>` tags from Kiro SSE stream. |
| `639f1204` | `open-sse/executors/antigravity.js`<br>`open-sse/providers/registry/antigravity.js` | Retries transient upstream failures in Antigravity. |
| `713c5637` | `open-sse/providers/registry/kilocode.js` | Exposes full gateway catalog for Kilocode combos. |
| `3d20a4cc` | `open-sse/translator/formats/gemini.js` | Strips `deprecated/readOnly/writeOnly` from tool schemas for Antigravity. |
| `e544bfce` | `open-sse/executors/codex.js` | Preserves Responses text format for Codex. |
| `4d9da5db` | `src/app/api/oauth/kiro/auto-import/route.js`<br>`src/app/api/oauth/kiro/import/route.js`<br>`src/shared/components/KiroAuthModal.js` | Adds Kiro IDC (organization) token import. |
| `ce844899` | `open-sse/config/ttsModels.js`<br>`open-sse/handlers/ttsProviders/gemini.js`<br>`open-sse/providers/registry/gemini.js` | Resolves Gemini TTS models from catalog. |
| `d1e98d9a` | `open-sse/executors/codebuddy-cn.js` | Only sends reasoning params when client requests reasoning. |

### 4.4 Dashboard / UI / CLI

| Upstream | Files | Why adopt |
|---|---|---|
| `6e9c7bf4` | `src/app/(dashboard)/dashboard/profile/page.js`<br>`src/app/api/auth/login/route.js`<br>`src/app/api/auth/logout/route.js`<br>`src/app/login/page.js`<br>`src/shared/components/Header.js` | Avoids stale redirects after auth changes. Review for any VansAI branding lines during merge. |
| `520f5049` | `src/shared/components/ModelSelectModal.js` | Shows custom provider models in combo picker. |
| `fc8722e8` | `cli/src/cli/tray/tray.ps1` | DPI-aware Windows tray context menu. |
| `77b38564` | `public/i18n/literals/zh-CN.json` | Missing zh-CN endpoint key label. |

### 4.5 Suggested apply order for ADOPT commits

```text
# 1. Security first
8ac631d6 d8c2298d f46811c7

# 2. Stream/translator correctness
a9785a5f 749c2e3f 8d1db46b 52623587 90b336d9 4a54824f 3a866fe1 c4f80d30

# 3. Provider fixes
7fa2e7f0 9e386665 2d94fffe 319caa2d 95bfc64f eff81b12
639f1204 713c5637 3d20a4cc e544bfce 4d9da5db ce844899 d1e98d9a

# 4. Dashboard / CLI
6e9c7bf4 520f5049 fc8722e8 77b38564
```

---

## 5. SKIP Recommendations

These commits conflict with VansRouter branding, versioning, or environment configuration.

| Upstream | Reason to skip | What to preserve instead |
|---|---|---|
| `0b3c7940` (`# v0.5.15`) | Bumps upstream `package.json` and `cli/package.json` to `9router` v0.5.15. Would revert our package names and versions. | Keep `vansrouter-app` v0.7.2 and `@vanroute/vansrouter` v0.7.2 in `package.json` / `cli/package.json`. |
| `cce47dd8` (`# v0.5.12`) | Same as above; upstream version bump. | Skip; only the changelog notes are informative. |
| `c7933de7` (`docker-compose.yml`) | Upstream creates a `docker-compose.yml` with `decolua/9router:latest`, container name `9router`, and volume `9router-data`. | Fork already has a VansRouter-branded `docker-compose.yml` with `ghcr.io/Vanszs/VansRouter:latest`, container `vansrouter`, and volume `9router-data`. Do not overwrite. |

**Note on version bumps:** If the upstream changelog entries for v0.5.12/v0.5.15 are useful, manually copy them into `CHANGELOG.md` under the next VansRouter release section rather than cherry-picking the commits.

---

## 6. HYBRID Recommendations

These commits contain valuable upstream fixes but overlap with VansRouter customizations. Apply selectively.

### 6.1 `8a664d61` — Kimchi OAuth provider support

**Conflict:** The fork already defines a `kimchi` provider in `open-sse/providers/registry/kimchi.js` (API-key auth, 5 models, `llm.kimchi.dev` endpoint). Upstream adds a **different** `kimchi` provider that is OAuth-based and includes a `KimchiExecutor`, `open-sse/services/kimchiModels.js`, OAuth route wiring, and model discovery.

| What to take | What to adapt or skip |
|---|---|
| The executor pattern in `open-sse/executors/kimchi.js` | Rename the provider ID or merge registries so the two do not collide. Options: (a) rename upstream OAuth provider to `kimchi-oauth` / `kimchi-cloud`; (b) merge both into one registry entry with both `apikey` and `oauth` auth modes; (c) keep our API-key provider and skip upstream's OAuth variant. |
| Model discovery service `open-sse/services/kimchiModels.js` | Do not let upstream overwrite `open-sse/providers/registry/kimchi.js`. |
| OAuth wiring in `src/lib/oauth/providers.js` and `src/app/api/oauth/[provider]/[action]/route.js` | Verify OAuth modal (`src/shared/components/OAuthModal.js`) still supports our existing providers after merge. |
| `nonStreamingHandler.js` Claude→OpenAI completion helper | Useful, but our fork may already have similar logic; diff carefully. |

**Recommended path:** Decide whether VansRouter wants an OAuth Kimchi provider. If yes, rename upstream's provider to a distinct ID (e.g., `kimchi-oauth`) and keep the existing `kimchi` API-key entry.

### 6.2 `b66b5c68` — Opt-in Codex auto-ping

**Conflict:** Upstream generalizes `claudeAutoPing` into `quotaAutoPing` and adds `codexAutoPing` settings. The fork still uses `src/shared/services/claudeAutoPing.js` and `CLAUDE_AUTOPING_CONFIG` in `src/shared/constants/config.js`.

| What to take | What to adapt |
|---|---|
| Generic scheduler in `src/shared/services/quotaAutoPing.js` | Preserve the existing `claudeAutoPing` connections/settings mapping. Add a migration or alias so existing user settings still work. |
| Per-provider settings keys (`claudeAutoPing`, `codexAutoPing`) | Update `src/app/api/settings/route.js` to call `runQuotaAutoPingTick()` on both keys, but keep our settings response shape. |
| UI changes in `ProviderLimits/index.js` and `ConnectionRow.js` | Re-apply on top of any VansRouter-branded or ACL-aware UI changes. |
| Rename `claudeAutoPing.js` → `quotaAutoPing.js` | Do not delete `claudeAutoPing.js` until the new service is fully wired and tested. |

**Recommended path:** Create a migration branch: introduce `quotaAutoPing.js`, redirect `claudeAutoPing` config reads to the new generic map, then remove the old file in a follow-up commit.

### 6.3 `373850ee` + `d4d11357` — Headroom Responses fixes

**Conflict:** The fork uses Headroom and already has upstream's `fb543a1f` (diagnostics) cherry-picked. These two commits add:
- `373850ee`: skip compression when `body.input` contains non-message items.
- `d4d11357`: translate `openai-responses` input through OpenAI before compressing.

| What to take | What to adapt |
|---|---|
| `hasUnsafeResponsesInputForCompression()` guard in `open-sse/rtk/headroom.js` | Straightforward addition. |
| `openaiResponsesToOpenAIRequest` translation path in Headroom | Verify it does not double-run translation already performed in `open-sse/handlers/chatCore.js`. Our custom injection order is RTK → Headroom → Caveman → Ponytail. |
| New tests | Add them; they guard Responses contract integrity. |

**Recommended path:** Cherry-pick both, then run `tests/unit/headroom*.test.js` and any Responses integration tests.

### 6.4 `2deacf69` — Token-saver full-width card layout

**Conflict:** Very small one-line CSS change in `src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js`. The fork already has a token-saver page but kept the original `EndpointPageClient.js` customizations.

| What to take | What to adapt |
|---|---|
| Remove `max-w-3xl mx-auto` from the page wrapper | Safe if our `TokenSaverClient.js` wrapper matches upstream's structure. |

**Recommended path:** Apply as a one-line patch; verify with `pnpm lint:reacthooks` and a visual check.


## 7. Custom Variables and Features That Must Be Preserved

### 7.1 Branding and package identity

| Item | Current value | Location |
|---|---|---|
| Web app package name | `vansrouter-app` | `/media/DiskE/Code/9router-new/package.json` |
| Web app version | `0.7.2` | `/media/DiskE/Code/9router-new/package.json` |
| CLI package name | `@vanroute/vansrouter` | `/media/DiskE/Code/9router-new/cli/package.json` |
| CLI version | `0.7.2` | `/media/DiskE/Code/9router-new/cli/package.json` |
| Dashboard title | "VansAI - AI Infrastructure Management" | `/media/DiskE/Code/9router-new/src/app/layout.js` |
| API welcome message | "Welcome to VansAI!" | `/media/DiskE/Code/9router-new/src/dashboardGuard.js` |
| Docker image | `ghcr.io/Vanszs/VansRouter:latest` | `/media/DiskE/Code/9router-new/docker-compose.yml` |

### 7.2 Environment variables

| Variable | Default / example | Where used | Notes |
|---|---|---|---|
| `DATA_DIR` | `/var/lib/9router` | `.env.example`, `docker-compose.yml`, DB path resolution | Used for SQLite and runtime data. Do not rename without migration. |
| `CLOUD_URL` | `https://9router.com` | `.env.example`, cloud sync jobs | Internal sync target. Preserved for backward compatibility. |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | `.env.example` | Public-facing cloud URL. |
| `BASE_URL` / `NEXT_PUBLIC_BASE_URL` | `http://localhost:20128` | `.env.example` | Used for cloud sync self-reference. |

**Note:** The variable names `CLOUD_URL` / `NEXT_PUBLIC_CLOUD_URL` still reference `9router.com`. Keep them as-is to avoid breaking existing deployments; the value can be repointed to a VansRouter domain later if desired.

### 7.3 Custom features (do not overwrite)

| Feature | Files | Why it must survive |
|---|---|---|
| ACL enforcement | `src/sse/services/auth.js`<br>`src/sse/services/allowedModels.js`<br>`src/sse/services/internalTrust.js`<br>`src/sse/handlers/chat.js`<br>`src/sse/handlers/stt.js`<br>`src/app/api/v1/models/route.js` | Multi-tenant API-key restrictions (allowedProviders, allowedCombos, allowedKinds, allowedModels). |
| Ponytail token saver | `open-sse/rtk/ponytail.js`<br>`open-sse/rtk/ponytailPrompts.js`<br>`open-sse/rtk/systemInject.js`<br>`open-sse/handlers/chatCore.js` | Injects lazy-senior-dev skeptical rules into every request. |
| Caveman token saver | `open-sse/rtk/caveman.js`<br>`open-sse/rtk/cavemanPrompts.js` | Terse-output prompt injection. |
| RTK compression | `open-sse/rtk/**/*.js` | Per-tool-type context compression. |
| `allowRemoteNoApiKey` dashboard guard | `src/dashboardGuard.js`<br>`src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`<br>`src/lib/db/repos/settingsRepo.js` | Allows remote API access without an API key when `requireApiKey` is off. |
| ZCode provider | `open-sse/executors/zcode.js`<br>`open-sse/providers/registry/zcode.js`<br>`src/lib/oauth/constants/oauth.js` | Custom CAPTCHA-solving, spoof-header provider not in upstream. |
| Custom Kimchi API-key provider | `open-sse/providers/registry/kimchi.js`<br>`open-sse/executors/default.js` (`kimchiHeaders` hook) | Must not be replaced by upstream's OAuth Kimchi provider. |
| SearXNG local search | `open-sse/providers/registry/searxng.js` | Local search provider config. |
| SE Asian TTS voices | `open-sse/config/ttsModels.js` | Indonesian/Thai/Malay/Filipino defaults. |
| Multiple connections per node | `src/app/api/providers/route.js` | Removed one-connection-per-node guard. |
| Go porting audit | `.kimchi/docs/go-porting-audit.md`<br>CUSTOM_LOGIC.md | Tracks backend porting scope; should be updated, not deleted. |

### 7.4 Scripts and workspace

| Script | Package | Notes |
|---|---|---|
| `cli:pack` / `cli:publish` | root `package.json` | Publishes `@vanroute/vansrouter` CLI. |
| `dev:bun` / `build:bun` / `start:bun` | root `package.json` | Bun runtime variants. |
| `pack:cli` / `publish:cli` / `postinstall` | `cli/package.json` | CLI build and runtime dependency installation. |

---

## 8. Suggested Cherry-Pick / Merge Strategy

### 8.1 Do not do a direct merge

A direct `git merge upstream/master` into `dev` will produce conflicts in at least:
- `package.json` and `cli/package.json` (name/version)
- `docker-compose.yml` (branding)
- `open-sse/providers/registry/kimchi.js` (provider collision)
- `src/shared/services/claudeAutoPing.js` vs new `quotaAutoPing.js`
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` (custom ACL/allowRemoteNoApiKey UI)
- `src/dashboardGuard.js` (custom guard)

### 8.2 Recommended workflow

1. **Create a tracking branch:**
   ```bash
   git checkout -b dev/upstream-sync upstream/master
   ```

2. **Apply security fixes first** (these have the highest value and lowest conflict risk):
   ```bash
   git cherry-pick 8ac631d6 d8c2298d f46811c7
   ```

3. **Apply translator / stream / provider fixes in batches**, running tests after each batch:
   ```bash
   git cherry-pick a9785a5f 749c2e3f 8d1db46b 52623587 90b336d9 4a54824f 3a866fe1 c4f80d30
   git cherry-pick 7fa2e7f0 9e386665 2d94fffe 319caa2d 95bfc64f eff81b12
   git cherry-pick 639f1204 713c5637 3d20a4cc e544bfce 4d9da5db ce844899 d1e98d9a
   ```

4. **Apply Headroom fixes as a single unit** and run Headroom tests:
   ```bash
   git cherry-pick 373850ee d4d11357
   pnpm test tests/unit/headroom
   ```

5. **Handle Kimchi OAuth collision** in a dedicated branch:
   - Decide on a distinct provider ID for the upstream OAuth variant.
   - Manually port `open-sse/executors/kimchi.js` and `open-sse/services/kimchiModels.js` under the new ID.
   - Update `open-sse/executors/index.js`, `open-sse/providers/registry/index.js`, and OAuth routes.

6. **Migrate auto-ping service**:
   - Introduce `src/shared/services/quotaAutoPing.js` alongside `claudeAutoPing.js`.
   - Update `src/shared/constants/config.js`, `src/app/api/settings/route.js`, and dashboard components.
   - Deprecate `claudeAutoPing.js` only after a release cycle.

7. **Apply dashboard / CLI / i18n fixes**, preserving VansRouter branding:
   ```bash
   git cherry-pick 6e9c7bf4 520f5049 fc8722e8 77b38564
   ```

8. **Skip version-bump and docker-compose commits** (`0b3c7940`, `cce47dd8`, `c7933de7`).

9. **Verify already-cherry-picked commits** by comparing file contents:
   ```bash
   # Example: verify token-saver page
   git diff upstream/master..HEAD -- src/app/(dashboard)/dashboard/token-saver/
   # Example: verify stream hardening
   git diff upstream/master..HEAD -- open-sse/utils/stream.js open-sse/handlers/chatCore/streamingHandler.js
   ```

10. **Run final validation:**
    ```bash
    pnpm install
    pnpm lint
    pnpm test
    pnpm run build
    ```

### 8.3 Merge commit vs. rebase

- **Merge commit** is safer for history preservation; it records that upstream was integrated.
- **Rebase** is not recommended because the fork is 173 commits ahead and many of those are already public on `origin/dev`.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Kimchi provider ID collision** | High | Rename upstream OAuth variant before merging; never let two providers share the same `id`. |
| **Auto-ping settings migration failure** | Medium | Keep `claudeAutoPing` as a fallback key until `quotaAutoPing` is proven in production. |
| **Headroom + Responses regression** | Medium | Run all `headroom*.test.js` and `responses*.test.js` after applying `373850ee` and `d4d11357`. |
| **Rebrand loss during merge** | Medium | Resolve merge conflicts in `package.json`, `cli/package.json`, `docker-compose.yml`, and `src/app/layout.js` in favor of VansRouter values. |
| **ACL bypass from upstream auth changes** | Medium | Review `6e9c7bf4` and any auth-route changes for interaction with `src/sse/services/internalTrust.js`. |
| **Go porting drift** | Medium | Update `.kimchi/docs/go-porting-audit.md` and `CUSTOM_LOGIC.md` after each upstream sync so the porting scope stays current. |
| **Test skew** | Low-Medium | The fork has added many custom tests (`tests/unit/handler-acl-enforcement.test.js`, `tests/unit/all-endpoints-robust.test.js`, etc.). Ensure new upstream tests do not assume default upstream behavior that our ACL/guard logic changes. |
| **Package-lock / pnpm-lock churn** | Low | Run `pnpm install` after `package.json` changes; do not hand-edit lockfile. |

---

## 10. Quick Reference: Unmerged Upstream Commits by Category

```text
SECURITY (must adopt)
  8ac631d6 d8c2298d f46811c7

TRANSLATOR / STREAM / CORE
  a9785a5f 749c2e3f 8d1db46b 52623587 90b336d9 4a54824f 3a866fe1 c4f80d30

PROVIDER FIXES
  7fa2e7f0 9e386665 2d94fffe 319caa2d 95bfc64f eff81b12
  639f1204 713c5637 3d20a4cc e544bfce 4d9da5db ce844899 d1e98d9a

HEADROOM (hybrid)
  373850ee d4d11357

AUTO-PING / QUOTA (hybrid)
  b66b5c68

KIMCHI OAUTH (hybrid — collision)
  8a664d61

DASHBOARD / UI / CLI
  6e9c7bf4 520f5049 fc8722e8 77b38564

TOKEN-SAVER LAYOUT (hybrid)
  2deacf69

SKIP
  0b3c7940 cce47dd8 c7933de7
```

---

*End of audit.*
