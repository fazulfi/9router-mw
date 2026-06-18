# Custom Logic — VansAI (9router Fork)

This document details all custom logic added on top of the upstream 9router codebase.
Each section covers the feature's purpose, flow, files, and behavioral rules.

---

## 1. ACL Enforcement System (Per-API-Key Access Control)

### Purpose
Restrict which providers, combos, service kinds, and models each API key can access.
Enables multi-tenant setups where different users get different levels of access.

### Tri-State Semantics
All ACL fields use the same tri-state pattern:
- `null` / `undefined` → **all allowed** (permissive default, unrestricted key)
- `[]` (empty array) → **none allowed** (deny everything)
- `["x", "y"]` → **only listed items allowed** (whitelist)

### Enforcement Order (chat.js)

```
Request arrives
  ↓
1. isTrustedInternalRequest? → bypass ALL ACL (machine-bound CLI token)
  ↓
2. requireApiKey enabled? → validate API key (isValidApiKey)
  ↓
3. isKindAllowed(apiKeyInfo, "llm") → 403 if denied
  ↓
4. Is model a combo?
   ├── Yes → isComboAllowed(apiKeyInfo, comboName) → 403 if denied
   └── No  → isProviderAllowed(apiKeyInfo, provider) → 403 if denied
  ↓
5. isModelAllowed(resolvedModelStr, apiKeyInfo) → 404 if denied
  ↓
6. Proceed to upstream provider call
```

### STT Handler (stt.js) — Same Pattern
Identical ACL flow but uses `isKindAllowed(apiKeyInfo, "stt")` instead of `"llm"`.

### Layer Details

#### Layer 1: `isTrustedInternalRequest`
- **File:** `src/sse/services/internalTrust.js`
- Reads `x-9r-cli-token` header
- Computes expected token from `getConsistentMachineId("9r-cli-auth")` (16-char hex, machine-bound)
- Compares using `crypto.timingSafeEqual` (constant-time, no timing side-channel)
- **Fails closed:** missing header, wrong length, bad token, exception → all return `false`
- Token is memoized after first computation

#### Layer 2: `isKindAllowed`
- **File:** `src/sse/services/auth.js` (line ~379)
- Checks `apiKeyInfo.allowedKinds` against the service kind
- Kinds: `"llm"`, `"embedding"`, `"image"`, `"tts"`, `"stt"`, `"web"`

#### Layer 3a: `isProviderAllowed`
- **File:** `src/sse/services/auth.js` (line ~344)
- Checks `apiKeyInfo.allowedProviders` against the provider
- Resolution chain: direct ID → alias → resolved ID → provider node prefix (cached 30s TTL)

#### Layer 3b: `isComboAllowed`
- **File:** `src/sse/services/auth.js` (line ~365)
- Checks `apiKeyInfo.allowedCombos` against the combo name
- Strips `combo/` prefix before matching

#### Layer 4: `isModelAllowed`
- **File:** `src/sse/services/allowedModels.js` (line ~461)
- Builds full allowed model ID set via `getAllowedModelIds()` (cached 30s)
- Checks both alias form and resolved `provider/model` form
- `modelKind()` function resolves kind from `model.kind`, `model.type`, or defaults to `"llm"`
- `ALL_KINDS`: `["llm", "tts", "embedding", "image", "imageToText", "stt", "webSearch", "webFetch"]`

### `/v1/models` ACL Filter
- **File:** `src/app/api/v1/models/route.js` (line ~456)
- After building full model list, filters by ACL if `apiKeyInfo` is present
- Combos → `isComboAllowed` + `stripComboPrefix`
- Regular models → `isProviderAllowed`
- Uses `Promise.all` for parallel evaluation
- Result: restricted key sees only allowed models (e.g., 19 instead of 108)

### Test Files
- `tests/unit/handler-acl-enforcement.test.js` — 37 tests covering all ACL layers
- `tests/unit/all-endpoints-robust.test.js` — 38 endpoint tests with ACL keys

---

## 2. Ponytail System Prompt Injection (Token Saver)

### Purpose
Inject a "lazy senior developer" ruleset into the system prompt to reduce unnecessary code output.
Orthogonal to Caveman: Ponytail governs *what* the model builds; Caveman governs *how* it talks.

### Injection Flow
```
Every POST /v1/chat/completions
  → handleChatCore() in chatCore.js
    → translateRequest() (format conversion)
    → RTK compressMessages() (context compression)
    → injectCaveman() (if enabled)
    → injectPonytail() (if enabled) ← HERE
    → executor.execute() (send to provider)
```

### Files
- `open-sse/rtk/ponytail.js` — Injector (delegates to `injectSystemPrompt` from caveman.js)
- `open-sse/rtk/ponytailPrompts.js` — Prompt text for all 3 levels
- `open-sse/handlers/chatCore.js` (line ~159) — Injection point

### Intensity Levels
| Level | Behavior |
|-------|----------|
| `lite` | Build what's asked, name the lazier alternative in one line |
| `full` | Ladder enforced — stdlib and native first, shortest diff |
| `ultra` | YAGNI extremist — deletion before addition, ship one-liner |

### Shared Components (in every level)
| Component | Purpose |
|-----------|---------|
| `SHARED_LADDER` | 6-rung decision ladder: skip → stdlib → native → dep → one-line → minimal |
| `SHARED_RULES` | No unrequested abstractions, no boilerplate, boring > clever |
| `SHARED_BOUNDARIES` | Never simplify: validation, error handling, security, accessibility |
| `SHARED_SKEPTICAL` | 6 verification rules (see section 3 below) |
| `SHARED_OUTPUT` | Code first, then ≤3 lines explaining what was skipped |
| `SHARED_PERSISTENCE` | Active every response, no drift back to over-building |

### Settings
- `ponytailEnabled` (boolean, default `false`)
- `ponytailLevel` (string, default `"full"`)
- Toggled in Dashboard → Endpoint page → Token Saver section

---

## 3. Skeptical AI Behavioral Rules

### Purpose
Mandate evidence-based claims from AI agents working on this codebase or responding via Ponytail.
Prevents false "fixed" claims, fabricated test reports, and hidden regressions.

### 6 Rules (in `SHARED_SKEPTICAL` + `AGENTS.md`)

1. **No assumptions without evidence** — Never claim "fixed"/"working"/"correct" without concrete proof
2. **Be skeptical of own results** — Verify tests test what you think, check side effects
3. **Never fabricate reports** — Don't claim "all tests pass" without running them
4. **Distinguish pre-existing vs caused-by-me** — Run tests BEFORE and AFTER, diff results
5. **Report honestly** — If broken, say so. If skipped, explain why. If caveats, state them
6. **Verify before declaring done** — Run tests AFTER changes, show actual output

### Where They Live
- `open-sse/rtk/ponytailPrompts.js` line ~40 (`SHARED_SKEPTICAL`) — injected into every Ponytail-enabled request
- `AGENTS.md` lines 1–30 — static rules for AI agents scanning the repo
- Both locations have the same 6 rules in different formats

---

## 4. SearXNG Local Instance

### Purpose
Self-hosted search provider for the `webSearch` service kind, no API key needed.

### Configuration
- **File:** `open-sse/providers/registry/searxng.js`
- `baseUrl: "http://127.0.0.1:8888/search"` — hardcoded to localhost
- Docker container: `searxng/searxng:latest`, id `e8b61d91f057`, port 8888
- `authType: "none"`, `noAuth: true`
- `searchTypes: ["web", "news"]`
- `costPerQuery: 0`, `freeMonthlyQuota: 999999`
- `timeoutMs: 10000`, `cacheTTLMs: 180000`

### Handler Quirk
The search handler expects `model: "searxng"` (provider ID), NOT `"searxng/search"` (full path from `/v1/models/web`).

---

## 5. Indonesian & Southeast Asian TTS Voices

### Purpose
Add default Indonesian and regional voices to the Edge-TTS provider.

### Voices Added
- **File:** `open-sse/config/ttsModels.js` (line ~74)
- `id-ID-ArdiNeural` — Indonesian male
- `id-ID-GadisNeural` — Indonesian female
- `th-TH-PremwadeeNeural` — Thai
- `ms-MY-YasminNeural` — Malay
- `tl-PH-BlessicaNeural` — Filipino/Tagalog
- Plus Vietnamese, Chinese, Japanese, Korean defaults

---

## 6. Dashboard Guard — `allowRemoteNoApiKey`

### Purpose
Opt-in setting allowing non-loopback requests to reach `/v1/*` without an API key.
Only effective when `requireApiKey` is OFF. Fail-closed default.

### Flow
```
Request to /v1/*
  → dashboardGuard.js middleware
    → isLocalRequest? → allow (loopback)
    → hasValidCliToken? → allow
    → hasValidApiKey? → allow
    → requireApiKey !== true AND allowRemoteNoApiKey === true? → allow
    → else → 401 "API key required for remote API access"
```

### Files
- `src/dashboardGuard.js` (line ~128) — `canAccessPublicLlmApi()` function
- `src/lib/db/repos/settingsRepo.js` (line ~19) — default `allowRemoteNoApiKey: false`
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` — UI toggle (shown when Require API Key is off)

### Test Coverage
- `tests/unit/dashboard-guard.test.js` — 9 tests covering allow/reject/contradiction/fail-closed/loopback

---

## 7. Translator Fixes

### `collapseTextParts` (message.js)
- **File:** `open-sse/translator/concerns/message.js` (line ~1)
- If ALL parts are text → join with `"\n"` into plain string (OpenAI canonical format)
- Otherwise → return array as-is (mixed content with images)
- Used in `open-sse/translator/formats/openai.js` `filterToOpenAIFormat()`
- Side effect: also fixed Kiro remote image URL bug (it.fails → it)

### `reasoningContentInjector` (regex fix)
- **File:** `open-sse/utils/reasoningContentInjector.js`
- Injects `" "` (single space) as `reasoning_content` placeholder for thinking-mode providers
- Provider-level: `PROVIDERS[provider]?.reasoningInject`
- Model-level: regex `/kimi-/i` → scope `"toolCalls"`, `/deepseek/i` → scope `"all"`
- Only on `role === "assistant"` messages, skips if already non-empty

---

## 8. Combo.js Fixes

### `web_search` Capability Detection
- **File:** `open-sse/services/combo.js` (line ~115)
- Scans `body.tools` for `type === "web_search"` → adds `"search"` to required capabilities
- Ensures combo auto-switch floats search-capable models to the front

### `reorderByCapabilities` Early Return
- Returns original array reference when no reordering needed (no required capabilities, single model, or no model matches any hard capability)
- Prevents pointless reshuffling

### `stripComboPrefix` Export
- Strips `"combo/"` prefix from combo names
- Imported by `models/route.js` for ACL filtering

---

## 9. VansAI Branding

### Files
- `src/app/layout.js` — Title: "VansAI - AI Infrastructure Management"
- `src/dashboardGuard.js` — API welcome: "Welcome to VansAI! Use {baseUrl}/v1 as your API endpoint."
- Default fallback host: `api.bevansatria.my.id`

---

## 10. Source Bug Fixes (Upstream Code Fixed Locally)

| File | Bug | Fix |
|------|-----|-----|
| `errorConfig.js` | Missing COOLDOWN_MS export | Added backward-compat COOLDOWN_MS object (upstream later fixed this too) |
| `rtk/constants.js` | LS_NOISE_DIRS was Array | Changed to Set for O(1) lookup |
| `rtk/index.js` | setRtkEnabled/isRtkEnabled broken | Fixed boolean logic |
| `combo.js` | web_search not detected in tools | Added scanning for `type === "web_search"` |
| `combo.js` | reorderByCapabilities no early return | Added early return for empty/single/no-match cases |
| `embeddings.js` | Double-prefix normalization (`nvidia/nvidia/model`) | Build candidates array checking multiple forms |
| `message.js` | collapseTextParts only handled single text part | Now joins ALL text parts with `\n` |
| `reasoningContentInjector.js` | Regex pattern incorrect | Fixed regex for provider/model matching |

---

## File Manifest

### Custom Files (not in upstream)
| File | Purpose |
|------|---------|
| `open-sse/rtk/ponytail.js` | Ponytail injector |
| `open-sse/rtk/ponytailPrompts.js` | Ponytail prompt levels + skeptical rules |
| `src/sse/services/allowedModels.js` | Model allowlist (isModelAllowed, modelKind) |
| `src/sse/services/internalTrust.js` | Trusted internal request detection |
| `AGENTS.md` | Behavioral rules for AI agents |
| `CUSTOM_LOGIC.md` | This file |
| `tests/unit/all-endpoints-robust.test.js` | Comprehensive endpoint tests (38) |
| `tests/unit/handler-acl-enforcement.test.js` | ACL enforcement tests (37) |

### Modified Files (custom changes on top of upstream)
| File | Custom Change |
|------|---------------|
| `src/sse/handlers/chat.js` | ACL enforcement (isKind/provider/combo/model) + apiKeyInfo propagation |
| `src/sse/handlers/stt.js` | ACL enforcement (same pattern as chat.js) |
| `src/app/api/v1/models/route.js` | ACL filter for /v1/models + capabilitiesFromServiceKind import |
| `open-sse/handlers/chatCore.js` | Ponytail injection section |
| `open-sse/config/ttsModels.js` | Indonesian + SE Asian voices |
| `open-sse/providers/registry/searxng.js` | Local baseUrl 127.0.0.1:8888 |
| `open-sse/translator/concerns/message.js` | collapseTextParts fix |
| `open-sse/translator/formats/openai.js` | Import + use collapseTextParts |
| `open-sse/utils/reasoningContentInjector.js` | Regex fix |
| `open-sse/services/combo.js` | web_search detection + early return + stripComboPrefix export |
| `src/app/layout.js` | VansAI branding + upstream GA/font script |
| `src/dashboardGuard.js` | canAccessPublicLlmApi with allowRemoteNoApiKey gate |
| `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` | allowRemoteNoApiKey toggle UI |
| `tests/unit/dashboard-guard.test.js` | 9 allowRemoteNoApiKey tests |
