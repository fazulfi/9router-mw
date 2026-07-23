# v0.5.40-mw.13 — fix: show MW release history in the dashboard

**Before**: Dashboard Change Log modal always fetches
`decolua/9router` CHANGELOG.md from upstream master. MW release entries
(mw.10+) never appear, regardless of which version is running.

**After**: Dashboard fetches the running MW release tag's CHANGELOG.md
from `fazulfi/9router-mw` — the in-app modal now shows mw.10–mw.13
entries and future MW releases will display their own changelog
automatically.

## Implementation

- `GITHUB_CONFIG.changelogUrl` in `src/shared/constants/config.js` now
  resolves to the immutable per-release URL using the app's
  `APP_CONFIG.version`.
- **release metadata**: align the app, CLI, and `VERSION` marker on mw.13.
- New regression test `changelog-source.test.js` verifies the URL points
  to `fazulfi/9router-mw` tag (not `decolua/9router` master).

# v0.5.40-mw.12 — batch: Responses translator fixes (2 PRs, 7 commits)

Cherry-picks from upstream PRs #2713, #2747 (authors: Edison42, ryanngit).

**Before**: Responses API terminal output is unreliable — streaming and
forced-non-stream paths diverge, producing truncated or broken terminal
arrays. Custom tool choices (e.g. `tool_choice: { function: "search" }`)
are lost during translation. Round-trip custom tool request/response
indexes collide, causing mismatched tool results.

**After**: A single per-request reducer (`responsesAccumulator.js`)
reliably reconstructs terminal output for both streaming and
forced-non-stream assembly, with alias-safe tool reconstruction and
exactly-once failure finalization. Forced `tool_choice` values are
preserved end-to-end. Custom tool requests and responses round-trip
with unique, non-colliding indexes. Two new test files guard custom
tool roundtrip and transformer item-index uniqueness.

- MW invariants (cluster, Redis, undici, WAL, liveUsageState, Cursor
  hotfix) fully preserved.

# v0.5.40-mw.11 — batch: Headroom fix + request observability (2 PRs)

Cherry-picks from upstream PRs #2698, #2710 (authors: hobart9527, ryanngit).

**Before**: Headroom compression runs *after* request translation, so it
only applies to OpenAI/Claude output formats. Non-standard formats
(commandcode, ollama, gemini, etc.) silently skip compression, wasting
upstream capacity. Request phases (translation, compression, upstream
call, auth) are opaque — no per-phase timing or correlation exists,
making performance debugging guesswork.

**After**: Headroom compression runs *before* translation, covering all
output formats equally. Request phases are timed and correlated per
provider request via `requestTiming.js`: each phase's duration is
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
format: `event: response.failed` payloads for OpenAI Responses API,
`event: error` frames for Claude, and generic error objects for all
other formats. New helpers `normalizeStreamError` and
`formatTranslatedStreamError`. Unit tests added for tool-call
validation and one-shot repair-all.

- MW invariants (cluster, Redis, undici, WAL, liveUsageState, Cursor
  hotfix) fully preserved.

# v0.5.40-mw.9 — batch: Minimax thinking sig + Grok daily meter (2 PRs)

Cherry-picks from upstream PRs #2706/#2705 (minimax), #2724/#2723 (grok usage).

## Changes

- **minimax** (PR #2706/2705): normalize unsigned Anthropic thinking block starts by injecting required empty signature field. New test file `minimax-thinking-signature.test.js`.
- **grok** (PR #2724/2723): add daily request meter endpoint and usage tracking. New test file `grok-daily-usage-route.test.js`.
- MW invariants (cluster, Redis, undici, WAL, liveUsageState, Cursor hotfix) fully preserved.

# v0.5.40-mw.8 — batch: 6 upstream PRs (azure, capabilities, combo, requestLogger, bind)

Cherry-picks from upstream PRs #2691, #2697, #2689, #2709, #2725 (authors: various).

## Changes

- **azure** (PR #2691): preserve explicit `max_completion_tokens` for gpt-5/o-series reasoning deployments.
- **capabilities** (PR #2697): support bare Kimi K3 upstream id.
- **combo** (PR #2689): add 11 unit tests for empty 200 response fallback.
- **requestLogger** (PR #2709): redact sensitive headers in logs (`maskSensitiveHeaders` already existed in MW).
- **cli** (PR #2699): IPv4-first DNS resolution (`--dns-result-order=ipv4first`) — already in MW. Skipped.
- **bind** (PR #2725): `--hostname 127.0.0.1` in dev/start scripts + `HOSTNAME=127.0.0.1` in `.env.example`.
- MW invariants (cluster, Redis, undici, WAL, liveUsageState, Cursor hotfix) fully preserved.

# v0.5.40-mw.7 — fix(db): encrypt provider connection secrets at rest (AES-256-GCM)

Cherry-pick from upstream PR #2776 (author: imran).

## Security

- **provider connections**: secrets at rest are now encrypted with AES-256-GCM.
  `SECRET_ENCRYPTION_KEY` env var (32-byte hex) required for production. Falls
  back to plain JSON if key is absent (graceful degradation).

## Changes

- `src/lib/db/helpers/secretCol.js` — new encryption/decryption helpers.
- `index.js`, `migrate.js`, `connectionsRepo.js` — `parseJson`/`stringifyJson`
  replaced with `decryptSecretJson`/`encryptSecretJson` for connection data.
- MW additions (settings cache, backup, dedup) fully preserved.

# v0.5.40-mw.6 — fix(cursor): implement real OAuth flow

Cherry-pick from upstream PR #2755 (author: dyntech).

## Features

- **cursor**: implement real PKCE OAuth login flow replacing the prior token
  provisioning approach. OAuth modal, callback route, import flow, and
  credential persistence. Machine ID validation removed (non-blocking).
- **OAuth**: shared provider OAuth infrastructure (`src/lib/oauth/*`) with
  provider-specific strategy pattern.
- **token refresh**: C-compatible token refresh wiring for Cursor credentials.

# v0.5.40-mw.5 — feat(gemini): Gemini 3.6 Flash and 3.5 Flash Lite

Merge from upstream PR #2779 (author: hmacderm).

## Features

- **gemini**: add Gemini 3.6 Flash and 3.5 Flash Lite models to provider registry,
  update API endpoints to daily-cloudcode-pa, add Cloud Code endpoint isolation
  and tier routing verification.
- **projectId**: pass explicit `provider` to `getProjectIdForConnection` for
  correct antigravity/gemini-cli project ID resolution.
- **antigravity**: retry hook and integration tests.

# v0.5.40-mw.4 — fix(server): bootstrap init services after listen

Cherry-pick from upstream PR #2764 (author: ryanngit).

## Enhancement

- **custom-server**: fire `GET /api/init` once after the worker starts listening.
  Enables bootstrap of runtime services (Redis connection validation, semaphore
  warming, usage-buffer flush timer) asynchronously without blocking `.start()`.

# v0.5.40-mw.3 — fix(cli): clean staged Next build before compiling

Cherry-pick from upstream PR #2748 (author: ryanngit).

## Bug fix

- **cli/build**: clean staged Next build cache before running compile step.
  Prevents stale `.next/` artifacts from corrupting production CLI builds
  when the build directory already exists from a prior run.

# v0.5.40-mw.2 (pending) — ancestry-merge of upstream/master (79918c78)

*Tag and deploy pending. Not yet shipped to production.*

## Ancestry merge

This release is a **real `git merge --no-ff upstream/master`** that establishes
true ancestry with `decolua/9router` master (no longer 13 commits behind). The
13 commits previously ported selectively (v0.5.40-mw.0) are now formally in
ancestry, and the merge has been resolved preserving every MW production
invariant. Backup ref: `backup/v0.5.40-mw.1-pre-ancestry-merge` at d9702c68.

## Upstream ancestry folded in (13 commits)

- **79918c78** v0.5.40 (release tag) — ancestry checkpoint
- **6994cd1f** fix(cursor): HTTP/2 AgentService support + version bump to 3.12.17
- **4f48ab8c** fix: resolve better-sqlite3 parameter array binding crash
- **c97963c4** fix(translator): pass `service_tier` through OpenAI→Responses conversion
- **cef5dd4d** fix(kiro): map GPT-5.6 reasoning effort fields
- **d587b2a4** fix(codex): current `client_version` + refresh-aware model sync
- **7c7fae39** fix(kiro): validate terminal streams before emitting output
- **9ba8f374** feat(i18n): add Khmer language support
- **55628eea** fix(alicode-intl): split into Coding Plan + Model Studio providers
- **c4a120af** docs(readme): update free-tier provider status for 2026
- **eb00222c** fix(kiro): map GPT reasoning effort fields
- **43d4abbc** docs(README): add Vietnamese OpenClaw Zalo video guide
- **e0ba6674** feat(cli-tools): configure Grok Build subagent models

## Conflict resolution (preserves MW invariants)

The following files conflicted during the merge and were resolved MW-side:

- `package.json`, `cli/package.json` — keep MW scripts/versions; take upstream Cursor 3.12.17 version bump
- `CHANGELOG.md`, `README.md` — keep MW enterprise-safe content; this entry documents the merge
- `open-sse/executors/cursor.js` — keep MW responseFormat hotfix; take upstream h2 AgentService
- `open-sse/services/cursorModels.js` — auto-merged; agentic/sonnet refresh data
- `open-sse/translator/request/openai-to-kiro.js` — keep MW invariants; fold upstream kiro mapping
- `src/shared/components/ModelSelectModal.js` — keep MW enterprise surface; fold upstream fix

## MW invariants preserved (unchanged)

- 4-worker cluster+respawn/no-double-request (`custom-server.js`)
- Redis 6381 only (semaphore/breaker/usage buffer)
- better-sqlite3 + WAL; sql.js banned in production
- settings cache invalidation
- liveUsageState / usage stream (Redis `mw:live:*`)
- undici global Agent (keep-alive)
- rich health, chat semaphore/breaker
- `VERSION` / `test:mw-claim`
- privacy `.gitignore` boundary (internal evidence untracked)
- absent `/mw` dashboard (canceled, not resurrected)
- Cursor `mw.1` `responseFormat: FORMATS.OPENAI` hotfix retained

## Rejected from upstream wholesale (preserved MW enterprise surface)

- Upstream marketing/README catalog — MW keeps its own enterprise README
- Upstream `/dashboard/providers/[id]` page restoration — the canceled `/mw` dashboard stays absent
- Upstream tiers/cost tables — MW does not duplicate the consumer marketing grid

## Prior MW line (summary)

- **mw.1** — Cursor `responseFormat: FORMATS.OPENAI` hotfix (live at d9702c68)
- **mw.0** — selective upstream v0.5.40 integration (8 clean cherry-picks)

# v0.5.40-mw.1 (2026-07-20) — Cursor responseFormat hotfix

## Fixes
- **Cursor REST/fallback**: set `responseFormat: FORMATS.OPENAI` in Cursor REST/fallback responses so the client receives OpenAI-compatible response shapes. Fixes Cursor client-side parsing errors when routed through the MW gateway.

# v0.5.40-mw.0 (2026-07-20) — selective upstream v0.5.40 integration

## Upstream sync: 8 clean cherry-picks
- **9ba8f374** feat(i18n): add Khmer language support
- **55628eea** fix(alicode-intl): split into Coding Plan + Model Studio providers
- **e0ba6674** feat(cli-tools): configure Grok Build subagent models
- **c97963c4** fix(translator): pass `service_tier` through OpenAI → Responses conversion
- **cef5dd4d** fix(kiro): map GPT-5.6 reasoning effort fields
- **d587b2a4** fix(codex): current `client_version` + refresh-aware model sync
- **7c7fae39** fix(kiro): validate terminal streams before emitting output
- **eb00222c** skipped (superseded by cef5dd4d)

## MW commits (selective patches)
- **fix(mw): spread better-sqlite3 positional bind params** — run/get/all `(...params)`
- **feat(mw): integrate cursor AgentService HTTP/2 support** — h2 executor, live model catalog, ModelSelectModal integration
- **chore(mw): bump upstream base to v0.5.40** — version `0.5.40-mw.0`, capabilities update

## Rejected changes
- Upstream README updates — MW maintains own enterprise README
- Dashboard page from cursor commit — canceled dashboard absence preserved

# v0.5.35-mw.8 (2026-07-19) — upstream sync (kimi dual-auth + dashboard UI)

## Upstream sync: 3 commits from decolua/9router

- **68566f53** feat(kimi): merge OAuth into dual-auth provider, add K3/K2.7 models
- **ccb0842d** fix(dashboard): cut duplicate API/icon spam, lazy-load provider assets
- **0513bf39** Flow animation — ProviderTopology.js + globals.css
- Branch `sync/2026-07` created, merged clean to master

# v0.5.35-mw.7 (2026-07-19) — live dashboard consistency across workers

## Fix: global dashboard state

- **Problem:** under multi-worker operation, the dashboard's recent-requests and active-counter badges flickered because each worker maintained its own in-memory state.
- **Solution:** shared global state so any worker can serve the same live dashboard snapshot, eliminating flicker across dashboard views.
- Fail-open to per-worker fallback if shared state is unavailable.

## Prior MW line (summary)

- **mw.6:** production finalization and data migration
- **mw.5:** hot-path hardening and operational reliability
- **mw.4:** connection reuse, production-safe SQLite, hot-path health
- **mw.3:** shared synchronization for multi-worker safety
- **mw.1–2:** multi-worker foundation and baseline deployment

# v0.5.35-mw.6 (2026-07-19) — production finalization and data migration

## Production final

- **Data migration:** provider connections, custom nodes, proxy pools, combos, and custom model data moved into production environment.
- **Documentation:** release status and execution records finalized.

## Prior MW line (summary)

- **mw.5:** hot-path hardening and operational reliability
- **mw.4:** connection reuse, production-safe SQLite, hot-path health
- **mw.3:** shared synchronization for multi-worker safety
- **mw.1–2:** multi-worker foundation and baseline deployment
