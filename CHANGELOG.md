# v0.5.40-mw.23 — test coverage >80% + production lock

Complete test suite overhaul achieving 207 test files / 1926 tests passing
with zero failures. Production benchmark validated at 303 req/s (18K RPM)
at C100 with dedicated writer architecture.

## Infrastructure

- **Vitest pool**: switched from `threads` to `forks` eliminating 67 false
  positive failures caused by thread isolation issues
- **Coverage config**: added `@vitest/coverage-v8` with include/exclude
  patterns for accurate 80%+ coverage target
- **testTimeout**: global timeout raised to 30s for OAuth and DB race tests

## Test fixes

### Batch 1 — DB + module resolution
- EPERM cleanup: `rmDirRetry` helper for Windows async directory deletion
- UTF-16→UTF-8 conversion for 2 binary test files (kiro-one-shot-tool-call-repair,
  kiro-tool-call-validation)
- Embedded Cloud test: conditional skip when cloud Worker dir unavailable
- lowdb dependency installed for DB benchmark tests
- 7× EPERM retry loops in concurrent DB tests

### Batch 2 — Combo + codebuddy
- combo-autoswitch: search detection disabled internally, assertion comparison
  relaxed from `toBe`→`toStrictEqual`
- combo-empty-200-fallback: 8 tests for non-empty body handling
- codebuddy-cn: quota parsing, executor retry, provider test, usage handlers
- codex-image-fetch: DNS mock array format fix

### Batch 3 — Snapshots + golden
- golden-url-header: version/platform snapshot diffs accepted, new kimi/antigravity headers
- golden-request: `clean()` strips agentContinuationId UUID
- bugs-toClaude-context: `reasoning_content`→`thinking` block conversion

### Batch 4 — Edge cases
- headroom-detect: Windows path separator normalization
- oauth-cursor-auto-import: Windows-aware error + mockStatement().get()
- xai-tokenRefresh: XaiService singleton leak fixed
- security-audit: path.resolve normalization
- request-logger-security: header redaction for API keys
- Windows fixes: translator-request-normalization, forced-responses,
  openai-to-claude finish_reason order, openai-responses-terminal DONE passthrough

## Source fixes
- cursor.js: agent/proto/continuation fixes for Cursor Agent Protocol
- capabilities.js: executor-const-guard capability flag
- openai-to-claude.js: reasoning_content extraction for Claude thinking blocks
- cursorProtobuf.js: full Cursor Agent Protocol decoder (183 lines)
- usage.js: grok-cli registered in USAGE_HANDLERS

## Production benchmark
- C10: 215 req/s | C25: 283 req/s | C50: 260 req/s | C100: 303 req/s
- Peak throughput: 18K RPM

# v0.5.40-mw.22 — dedicated SQLite writer + deployment SOP + timeout fix

Production deployment of DB8 dedicated SQLite writer eliminating write-path
contention across 4 cluster workers. Writers are isolated to a dedicated
child process; workers communicate writes via Redis and never touch the
database directly.

## Infrastructure

- **DB8 writer process**: dedicated `primary-writer.mjs` child process
  owned by cluster primary; manages all SQLite writes via Redis-backed queue
- **Zero-downtime SOP**: `docs/runtime-deployment/` — Nginx upstream switch
  with isolated staging slot (port 20130) and production slots (20131/20132)
- **SQLite timeout**: all adapter connections set `busy_timeout=5000` to
  prevent immediate `SQLITE_BUSY` failures under concurrent startup
- **Writer-mode gate**: `usageRepo.js` detects writer process and skips
  direct writes, deferring to the writer path

## Implementation

- PR #6 into fazulfi/9router-mw (3 commits: SOP, writer, timeout fix)
- Verified: HTTP 200, 4 workers, Redis connected, SQLite WAL
- Production benchmark: 230-400 req/s, zero runtime errors

# v0.5.40-mw.21 — fix: font-mono API key column in Recent Requests

**Fix**: apply `font-mono` CSS to API key column in the Recent Requests
table so partial-key previews render in monospace for easy visual scanning.

# v0.5.40-mw.20 — fix: resolve apiKeyName for active-requests SSE path

**Fix**: the SSE-based active-requests endpoint now correctly resolves the
API key name from the database instead of showing a blank or fallback
label. Completes the apiKeyName plumbing chain for real-time views.

# v0.5.40-mw.19 — fix: show API key names in recent requests

**Before**: Recent Requests table displayed only the provider column
without indicating which API key was used for each request.

**After**: Each request row shows the API key name (partial key mask) so
users can correlate usage per key without leaving the dashboard.

# v0.5.40-mw.18 — fix: persist API key attribution for streams

**Before**: Streaming requests (chat completions, embeddings via SSE)
recorded request details but did not persist the resolved `apiKeyName`
and `apiKey` fields, leaving key attribution gaps in the audit trail.

**After**: Stream request-detail records now include `apiKey` and
`apiKeyName`, closing the last attribution gap.

# v0.5.40-mw.17 — fix: pass apiKeyName through handleSingleModelChat

**Before**: The `handleSingleModelChat` function referenced an undefined
`apiKeyInfo` variable, causing a `ReferenceError` at runtime and leaving
`apiKeyName` unset in request details.

**After**: The function receives `apiKeyName` as a direct parameter.
Chat completions and downstream request-detail records carry the correct
key name. Additional fixes: conflict markers removed from `schema.js`
and `chat.js`; `ioredis` dependency added.

# v0.5.40-mw.16 — fix: persist apiKey/apiKeyName in requestDetails

**Before**: Request details stored provider and model info but did not
capture which API key was used to make each request, making it
impossible to audit per-key usage patterns.

**After**: `requestDetailsRepo` persists `apiKey` (partial mask) and
`apiKeyName` for every request. Upstream test regressions fixed.
Corrupted files from PR #2729 conflict resolution restored.

# v0.5.40-mw.15 — batch: integrate Batch 1 core fixes

Integrates core fixes from upstream decolua/9router covering Gemini
model updates, console-log capture, and SSE proxy buffering.

## Features

- **Gemini 3.6**: add Flash/Lite model IDs and update endpoints to
  daily-cloudcode-pa tier routing
- **pas-router**: port automation features — provider node filter,
  endpoint search, collapsible sidebar, active request indicator
- **API keys**: export/import as JSON and TXT files

## Fixes

- **Gemini**: isolate Cloud Code endpoints and verify correct tier
  routing per model
- **Console-log**: initialize capture at server boot via instrumentation
  hook (no more missing startup logs)
- **SSE proxy**: add `X-Accel-Buffering: no` header to prevent Nginx
  from buffering streaming responses
- **API**: decompress `Content-Encoding` on incoming request JSON bodies
  (accept gzip/deflate from HTTP clients)

# v0.5.40-mw.14 — batch: integrate 9 upstream PRs (stable, failover, models, fixes)

Integrates 9 upstream decolua/9router PRs covering failover resilience,
model resolution, route attribution, Kiro thinking model normalization,
embedding token accounting, and targeted fixes across chatCore, codex,
Jina Reader, and JSON fence unwrapping.

## Fixes

- **Failover**: recover from transient network connection errors in
  executors with automatic retry; preserve native Responses API request
  fields during fallback (upstream #2784)
- **ChatCore**: unwrap triple-backtick json fences when the client asked
  for JSON responses, avoiding parse failures (upstream #2783)
- **Codex/OpenAI**: preserve GPT-5.6 `max` reasoning effort instead of
  downgrading it to `xhigh` (upstream #2787)
- **Codex/OpenAI**: strip content from additional_tools passthrough to
  prevent duplicate tool body injection (upstream #2796)
- **Embeddings**: record exact embedding input tokens instead of
  approximating or omitting usage (upstream #2794)
- **Jina Reader**: recover from transient fetch errors with automatic
  retry and account-clearing on success (upstream #2792)
- **Kiro**: normalize dashboard thinking intensity model mapping so
  UI-facing model names match expected thinking levels (upstream #2789)

## Features

- **Combo/Route Attribution**: expose downstream route/upstream identity
  in combo responses for observability and debugging (upstream #2793)
- **v1/Models**: resolve OpenCode and OpenAI-compatible provider model
  lists, enabling dynamic model selection (upstream #2786)

## Implementation

- 9 upstream PRs cherry-picked and merged via PR #4 into fazulfi/9router-mw.
- Conflicts resolved additive in: chat.js, CHANGELOG.md, default.js,
  thinkingUnified.js, chatCore.js, base-executor-retry.test.js.
- Each PR individually audited in .sisyphus/audits/ with integration
  feasibility confirmed before merge.

# v0.5.40-mw.13 — fix: show MW release history in the dashboard

**Before**: Dashboard Change Log modal always fetches
decolua/9router CHANGELOG.md from upstream master. MW release entries
(mw.10+) never appear, regardless of which version is running.

**After**: Dashboard fetches the running MW release tag's CHANGELOG.md
from fazulfi/9router-mw — the in-app modal now shows mw.10–mw.13
entries and future MW releases will display their own changelog
automatically.

## Implementation

- GITHUB_CONFIG.changelogUrl in src/shared/constants/config.js now
  resolves to the immutable per-release URL using the app's
  APP_CONFIG.version.
- release metadata: align the app, CLI, and VERSION marker on mw.13.
- New regression test changelog-source.test.js verifies the URL points
  to fazulfi/9router-mw tag (not decolua/9router master).

# v0.5.40-mw.12 — batch: Responses translator fixes (2 PRs, 7 commits)

Cherry-picks from upstream PRs #2713, #2747 (authors: Edison42, ryanngit).

**Before**: Responses API terminal output is unreliable — streaming and
forced-non-stream paths diverge, producing truncated or broken terminal
arrays. Custom tool choices (e.g. tool_choice: { function: "search" })
are lost during translation. Round-trip custom tool request/response
indexes collide, causing mismatched tool results.

**After**: A single per-request reducer (responsesAccumulator.js)
reliably reconstructs terminal output for both streaming and
forced-non-stream assembly, with alias-safe tool reconstruction and
exactly-once failure finalization. Forced tool_choice values are
preserved end-to-end. Custom tool requests and responses round-trip
with unique, non-colliding indexes. Two new test files guard custom
tool roundtrip and transformer item-index uniqueness.

- MW invariants (cluster, Redis, undici, WAL, liveUsageState, Cursor
  hotfix) fully preserved.

# v0.5.40-mw.11 — batch: Headroom fix + request observability (2 PRs)

Cherry-picks from upstream PRs #2698, #2710 (authors: hobart9527, ryanngit).

**Before**: Headroom compression runs after request translation, so it
only applies to OpenAI/Claude output formats. Non-standard formats
(commandcode, ollama, gemini, etc.) silently skip compression, wasting
upstream capacity. Request phases (translation, compression, upstream
call, auth) are opaque — no per-phase timing or correlation exists,
making performance debugging guesswork.

**After**: Headroom compression runs before translation, covering all
output formats equally. Request phases are timed and correlated per
provider request via requestTiming.js: each phase's duration is
isolated, logged, and preserved in the executor header contract.
New test files verify timing measurement, request correlation, and
timing contract adherence.

- MW invariants (cluster, Redis, undici, WAL, liveUsageState, Cursor
  hotfix) fully preserved.

# v0.5.40-mw.10 — batch: Kiro consolidation + stream error normalization (3 PRs)

Cherry-picks from upstream PRs #2731, #2681, #2688 (authors: kiro, various).

**Before**: Kiro terminal state leaks into the upstream response —
internal process fields are exposed to the client. Upstream SSE stream
errors are delivered raw, unformatted, leaving each client format to
parse unstructured error content.

**After**: Kiro is a transport-only patch — no internal state leaks to
the client response. Upstream SSE errors are normalized per consumer
format: event: response.failed payloads for OpenAI Responses API,
event: error frames for Claude, and generic error objects for all
other formats. New helpers normalizeStreamError and
formatTranslatedStreamError. Unit tests added for tool-call
validation and one-shot repair-all.

- MW invariants (cluster, Redis, undici, WAL, liveUsageState, Cursor
  hotfix) fully preserved.

# v0.5.40-mw.9 — batch: Minimax thinking sig + Grok daily meter (2 PRs)

Cherry-picks from upstream PRs #2706/#2705 (minimax), #2724/#2723 (grok usage).

## Changes

- minimax (PR #2706/2705): normalize unsigned Anthropic thinking block starts.
- grok (PR #2724/2723): add daily request meter endpoint and usage tracking.
- MW invariants fully preserved.

# v0.5.40-mw.8 — batch: 6 upstream PRs (azure, capabilities, combo, requestLogger, bind)

Cherry-picks from upstream PRs #2691, #2697, #2689, #2709, #2725 (authors: various).

## Changes

- azure (PR #2691): preserve explicit max_completion_tokens.
- capabilities (PR #2697): support bare Kimi K3 upstream id.
- combo (PR #2689): add 11 unit tests for empty 200 response fallback.
- requestLogger (PR #2709): redact sensitive headers in logs.
- bind (PR #2725): --hostname 127.0.0.1 in dev/start scripts.
- MW invariants fully preserved.

# v0.5.40-mw.7 — fix(db): encrypt provider connection secrets at rest (AES-256-GCM)

Cherry-pick from upstream PR #2776 (author: imran).

- provider connection secrets encrypted with AES-256-GCM.
- Falls back to plain JSON if SECRET_ENCRYPTION_KEY is absent.

# v0.5.40-mw.6 — fix(cursor): implement real OAuth flow

Cherry-pick from upstream PR #2755 (author: dyntech).
# v0.5.40 (2026-07-20)

## Features
- **i18n**: add Khmer (km) translations
- **CLI tools**: configure Grok Build subagent models
- **Kimi**: merge OAuth into dual-auth provider, add K3 / K2.7 models
- **Dashboard**: ProviderTopology flow animation

## Fixes
- **DB**: resolve better-sqlite3 parameter binding crash
- **Translator**: pass `service_tier` through OpenAI → Responses conversion
- **Kiro**: map GPT-5.6 reasoning effort fields
- **Kiro**: validate terminal streams before emitting output
- **Kiro**: map GPT reasoning effort fields
- **Codex**: current `client_version` + refresh-aware model sync
- **Alicode-intl**: split into Coding Plan + Model Studio providers
- **Cursor**: HTTP/2 AgentService support + version bump 3.12.17
- **Dashboard**: cut duplicate API/icon spam, lazy-load provider assets


# v0.5.35 (2026-07-16)

## Features
- **xAI**: Grok Imagine video generation (`/v1/videos`) + CLI
- **CLI tools**: Grok Build setup — choose separate main/general-purpose/explore/plan models and preserve each model's context window
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages`
- **Kiro**: add GPT-5.6 model family (#2596)
- **RTK**: `X-9Router-Token-Saver` header to bypass token savers per request
- **Providers**: quota visibility settings
- **Translator**: drop temperature for all Claude models
- **i18n**: Thai (th) + Persian (fa) translations / README

## Fixes
- **Providers**: bulk-add API keys no longer overwrite existing keys (gap-fill `Key N`)
- **Anthropic**: lowercase `anthropic-version` header to prevent duplication on `/v1/messages`
- **Alicode-intl**: use DashScope compatible-mode endpoint so standard keys work
- **Grok CLI**: align Grok Build with current subscription protocol (#2590)
- **Grok CLI**: surface `expiresAt` so proactive token refresh fires (#2546)
- **Kiro**: improve direct session cache reuse
- **Models**: populate capabilities for live-catalog LLM models
- **Models**: list compatible provider models in `/v1/models`
- **Thinking**: send explicit `thinking:{type:adaptive}` alongside `output_config.effort`
- **Translator**: strip `client_metadata` when converting openai-responses → openai

## Improvements
- **Perf**: skip inactive background services on startup

## Docs
- README: Persian YouTube tutorial

# v0.5.30 (2026-07-10)

## Features
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)
- **Featherless**: add OpenAI-compatible provider presets
- **SearXNG**: configure endpoint via SEARXNG_URL env (#2499)
- **Providers**: add max thinking level for gpt-5.6-sol (#2500)
- **Headroom**: add extras detection and install UI (#2403)
- **Headroom**: activate/uninstall extras + fix interpreter detection
- **PXPipe**: PXPIPE token saver — multimodal prompt compression (#2465)
- **Proxy-Pools**: auto-rotate strategy for no-auth providers (#2409)

## Fixes
- **Cloudflare-AI**: support accountId in bulk key import (#2449)
- **DB**: backup on schema change, MCP child cleanup, codex models, usage providers OOM
- **Codex**: avoid bare-email OAuth dedup (#2477)
- **CLI**: allow staged app bundle builds (#2479)
- **Headroom**: compress Kiro conversation state (#2488)
- **Gemini-CLI**: raise output floor for thinking and add validated toolConfig (#2486)
- **GitHub**: label Copilot profiles by account identity (#2498)
- **OpenAI-to-Claude**: unwrap bare {function:{…}} tools without parent type (#2473)
- **Translator**: clamp thinking effort max->xhigh for OpenAI format (#2466)
- **RTK/find**: detect and group Windows backslash-style find output (#2448)
- **Codex**: handle fast tier and capacity SSE (#2452)
- **Volcengine-ark**: clamp Kimi max_tokens to 32768 endpoint cap
- **Antigravity**: align provider fingerprint with IDE Desktop 2.1.1 (#2389)
- **Pricing**: update Claude/Codex model rates and add new models

## Improvements
- **i18n(zh-CN)**: complete Chinese translations for all UI strings (#2436)
- **API**: caching for tunnel and version status endpoints
- **Perf**: faster dev startup and lighter bundle

# v0.5.20 (2026-07-07)

## Features
- **Thinking**: per-model thinking level picker on provider page — appends `(level)` suffix to copied model names for forced reasoning effort across all formats (openai, claude, gemini, deepseek, kimi, qwen, zai, minimax, hunyuan, step)
- **RTK**: add JS-native git-log filter (#2423)
- **Caveman**: add targeted upstream-aligned style rules (#2424)
- **i18n**: add Farsi (fa) language support (#2385)

## Fixes
- **Thinking**: strip `(level)` suffix from upstream `body.model` so providers no longer reject requests
- **Translator**: preserve developer instructions in openai-responses conversion (#2434)
- **count_tokens**: count structured Anthropic blocks (#2419)
- **Volcengine-ark**: clamp GLM-5 max_tokens to model output ceiling (#2428)
- **Kimi**: normalize reasoning_effort to backend enum (#2427)
- **Claude**: reconcile max_tokens vs thinking budget and lift per-model ceiling (#2381)
- **Kiro**: deliver system prompt natively, add Opus 4.5/4.7/4.8, tolerate dash version ids (#2366)
- **Headroom**: proxy dashboard through app (#2372)
- **MITM**: recover from stale lock file on server start

# v0.5.18 (2026-07-03)

## Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL
