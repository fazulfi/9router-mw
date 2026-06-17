# Zcode (Z.ai) OAuth Implementation Status

## ✅ COMPLETE — Verified End-to-End

Single unified `zcode` provider. BigModel sub-option deleted (geo-blocked from VPS, user request).

## Architecture

Mirror real ZCode v3.1.0 client:
- `redirectUri`: `zcode://zai-auth/callback` (only URI accepted by Z.ai for this client_id)
- `clientId`: `client_P8X5CMWmlaRO9gyO-KSqtg` (env: `ZAI_OAUTH_CLIENT_ID`)
- **PKCE** (S256) — code_challenge sent in authorize, code_verifier in token exchange
- **Token proxy**: `POST https://zcode.z.ai/api/v1/oauth/token` (server holds client_secret)
- **Body**: `{ provider:"zai", code, redirect_uri, state, code_verifier }` (JSON, not form-encoded)
- **User info**: `GET https://chat.z.ai/api/oauth/userinfo` (Authorization: Bearer)
- **Business token**: `POST https://api.z.ai/api/auth/z/login` with `{token}` → `data.access_token`
- **Subscription**: `GET https://api.z.ai/api/biz/subscription/list` (uses businessToken)
- **API base**: `https://api.z.ai/api/anthropic/v1/messages` (Claude format, Authorization: Bearer businessToken)

## VPS-Specific Flow (no localhost callback possible)

Z.ai only accepts `zcode://zai-auth/callback` for this client_id. VPS HTTPS URLs always rejected.

1. User clicks **Connect** on Zcode → 9router generates `authUrl`
2. Modal opens "Manual paste" mode → user clicks **Open login URL** → goes to `chat.z.ai/auth?...`
3. User logs in at Z.ai → Z.ai redirects to `zcode://zai-auth/callback?code=X&state=Y` (browser shows `ERR_UNKNOWN_URL_SCHEME`)
4. User **copies full URL from address bar** → **pastes into modal** → submit
5. 9router extracts `code` + `state`, validates state, exchanges via token proxy
6. Fetches user info + business token + subscription, stores connection

## Robustness (zcode handler)

- **20s AbortController timeout** on token exchange
- **10s timeouts** on user info + subscription fetches
- **15s timeout + 1 retry (1s backoff)** on business token exchange
- Clear error messages: `"Z.ai token exchange failed: <msg>"`, `"Z.ai token exchange timed out (20s)"`
- Business token / subscription failures are **non-fatal** (warn + continue, don't block connect)
- **Server-side defense-in-depth**: API route defaults to `zcode://zai-auth/callback` for zcode provider when client doesn't pass `redirect_uri` (prevents localhost fallback)
- Manual paste parser handles all variants:
  - `zcode://...?code=X&state=Y` ✓
  - `zcode://...?authCode=X&state=Y` ✓
  - `https://...?code=X&state=Y` ✓
  - Bare code `XYZ` → `{code, needsState: true}` ✓
  - Invalid → clear error

## Files

- `src/lib/oauth/constants/oauth.js` — `ZAI_CONFIG` only (BigModel deleted), all URLs/clientIds
- `src/lib/oauth/providers.js` — zcode handler: Z.ai only, timeouts + retry, no BIGMODEL_CONFIG import
- `src/shared/components/OAuthModal.js` — zcode always `redirectUri = "zcode://zai-auth/callback"`, manual paste parser
- `src/app/api/oauth/[provider]/[action]/route.js` — line 79 defaults to `zcode://zai-auth/callback` for zcode
- `src/shared/constants/providers.js` — `OAUTH_PROVIDERS.zcode` registered
- `open-sse/config/providers.js` — `PROVIDERS.zcode` = api.z.ai Claude format
- `open-sse/config/providerModels.js` — `PROVIDER_MODELS.zcode` = 4 variants
- `public/providers/zcode.png` — logo

## Verified

- ✅ All 7 modified files pass `node --check`
- ✅ BigModel refs removed from OAuth paths
- ✅ `/api/oauth/zcode/authorize` returns `redirect_uri=zcode%3A%2F%2Fzai-auth%2Fcallback`
- ✅ Real Z.ai endpoint accepts authUrl → `HTTP 307 → /auth?...&redirect_uri=zcode%3A%2F%2Fzai-auth%2Fcallback&...`
- ✅ ZCode token proxy reachable, accepts ZCode format
- ✅ Z.ai business login reachable
- ✅ zcode provider loads on detail page (HTTP 200)
- ✅ Dev log clean — no new errors after hot-reload

## User Action Required

Open `http://<vps>:9000/dashboard/providers/zcode` → click **Connect** → complete login → paste `zcode://zai-auth/callback?code=...&state=...` URL → verify connection succeeds with email + plan.

## Pending (not blocking login)

- **zcode executor** at `open-sse/executors/zcode.js` — connection will work but actual chat calls will fail (no Claude-format → api.z.ai executor with ZCode headers + 401 → re-exchange business token)
- Register `zcode` (+ alias `zc`) in `open-sse/executors/index.js`
- "Model tidak ada secara default" UI issue not investigated
