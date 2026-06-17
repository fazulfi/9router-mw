# Z.ai & BigModel OAuth Implementation Summary

**Date**: 2026-06-16  
**Status**: Partial - OAuth endpoints confirmed, token exchange needs testing

---

## ✅ Confirmed Information

### Z.ai OAuth Endpoints

From reverse engineering ZCode Linux AppImage (version 3.1.0):

```javascript
// OAuth Configuration (CONFIRMED)
{
  // Authorization endpoint - CONFIRMED from ZCode traffic
  authorizeUrl: "https://chat.z.ai/auth/oauth/authorize",
  
  // Client ID - CONFIRMED from ZCode OAuth URL
  clientId: "client_P8X5CMWmlaRO9gyO-KSqtg",
  
  // Token endpoint - LIKELY (standard OAuth pattern)
  tokenUrl: "https://chat.z.ai/auth/oauth/token",
  
  // Client info endpoint - CONFIRMED from console error
  clientInfoUrl: "https://chat.z.ai/api/oauth/authorize/info",
  
  // ZCode redirect URI pattern
  redirectUri: "zcode://zai-auth/callback",
  
  // API Base URL - CONFIRMED from ZCode documentation
  apiBaseUrl: "https://api.z.ai/api/anthropic"
}
```

### OAuth Flow (Standard OAuth 2.0 Authorization Code)

```
1. User clicks "Connect Z.ai" in 9router
   ↓
2. 9router redirects to:
   https://chat.z.ai/auth/oauth/authorize?
     response_type=code&
     client_id=client_P8X5CMWmlaRO9gyO-KSqtg&
     redirect_uri=http://localhost:9877/oauth/callback/zai&
     state=random_state_string&
     scope=openid+profile+email  // scopes TBD
   ↓
3. User logs in at Z.ai (if not already logged in)
   ↓
4. User authorizes ZCode/9router application
   ↓
5. Z.ai redirects back:
   http://localhost:9877/oauth/callback/zai?
     code=AUTH_CODE_HERE&
     state=random_state_string
   ↓
6. 9router exchanges code for tokens:
   POST https://chat.z.ai/auth/oauth/token
   Content-Type: application/x-www-form-urlencoded
   
   grant_type=authorization_code&
   code=AUTH_CODE_HERE&
   client_id=client_P8X5CMWmlaRO9gyO-KSqtg&
   client_secret=MAYBE_NEEDED&  // TBD: public vs confidential client
   redirect_uri=http://localhost:9877/oauth/callback/zai
   ↓
7. Z.ai returns tokens (UNIQUE PER USER):
   {
     "access_token": "user_specific_token_abc123",
     "refresh_token": "user_specific_refresh_token_xyz",
     "expires_in": 3600,
     "token_type": "Bearer",
     "scope": "openid profile email"
   }
   ↓
8. 9router stores tokens in database (per user)
   ↓
9. 9router uses access_token to call Z.ai API:
   POST https://api.z.ai/api/anthropic/v1/messages
   Authorization: Bearer user_specific_token_abc123
   ...
```

---

## ⚠️ Needs Testing/Confirmation

### 1. Token Endpoint Format
- **Endpoint**: `https://chat.z.ai/auth/oauth/token` (needs confirmation)
- **Method**: POST (standard)
- **Content-Type**: `application/x-www-form-urlencoded` or `application/json`?
- **Client Authentication**: 
  - Public client (no client_secret, may use PKCE)?
  - Confidential client (requires client_secret)?

### 2. Required Scopes
- Standard: `openid profile email`?
- Z.ai specific scopes?
- Coding Plan access scope?

### 3. Client Secret
- Is client_secret required?
- Or is this a public client (PKCE flow)?

### 4. Token Response Format
```json
{
  "access_token": "?",
  "refresh_token": "?",
  "expires_in": ?,
  "token_type": "Bearer",
  "scope": "?",
  // Any additional fields?
}
```

### 5. Refresh Token Flow
```
POST https://chat.z.ai/auth/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token=user_refresh_token&
client_id=client_P8X5CMWmlaRO9gyO-KSqtg&
client_secret=MAYBE_NEEDED
```

### 6. User Info Endpoint
After getting access_token, how to get user info?
- Endpoint: `https://chat.z.ai/api/v1/users/user` (from HTML)?
- Or: `https://chat.z.ai/api/user/info`?
- Or: `https://api.z.ai/api/user/info`?

### 7. Quota/Subscription Endpoint
How to check user's quota and subscription?
- Endpoint: `https://chat.z.ai/api/coding-plan/info`?
- Or different endpoint?

---

## 🔧 What 9router Needs to Implement

### 1. OAuth Configuration Update

Update `/media/DiskE/Code/9router/src/lib/oauth/constants/oauth.js`:

```javascript
export const ZAI_CONFIG = {
  // CONFIRMED endpoints
  clientId: "client_P8X5CMWmlaRO9gyO-KSqtg",
  clientSecret: process.env.ZAI_OAUTH_CLIENT_SECRET || "", // May not be needed
  authorizeUrl: "https://chat.z.ai/auth/oauth/authorize",
  tokenUrl: "https://chat.z.ai/auth/oauth/token",
  userInfoUrl: "https://chat.z.ai/api/user/info", // TBD
  scopes: ["openid", "profile", "email"], // TBD
  
  // API endpoints
  apiBaseUrl: "https://api.z.ai/api/anthropic",
  quotaUrl: "https://chat.z.ai/api/quota/usage", // TBD
  
  userAgent: "9router/1.0",
  region: "global",
};
```

### 2. OAuth Flow Handler

Already implemented in `/media/DiskE/Code/9router/src/lib/oauth/providers.js`:
- ✅ buildAuthUrl - builds authorization URL
- ✅ exchangeToken - exchanges code for tokens
- ✅ postExchange - fetches user info and quota
- ✅ mapTokens - stores tokens in database

### 3. Per-User Token Storage

Database schema (likely already exists):
```sql
CREATE TABLE oauth_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  provider VARCHAR(50), -- 'zai' or 'bigmodel'
  access_token TEXT,     -- UNIQUE PER USER
  refresh_token TEXT,    -- UNIQUE PER USER
  expires_at TIMESTAMP,
  email VARCHAR(255),
  plan_id VARCHAR(100),
  tier VARCHAR(50),
  provider_specific_data JSONB
);
```

---

## 🧪 Next Steps for Testing

### Option A: Manual Test with Browser
1. Open browser to: `https://chat.z.ai/auth/oauth/authorize?response_type=code&client_id=client_P8X5CMWmlaRO9gyO-KSqtg&redirect_uri=http://localhost:9877/oauth/callback/zai&state=test123`
2. Login with test credentials
3. Authorize the application
4. Capture the authorization code from redirect
5. Test token exchange with curl

### Option B: Intercept Real ZCode Traffic
1. Run mitmproxy: `bash /tmp/opencode/capture-zcode-oauth.sh`
2. Launch ZCode with proxy settings
3. Perform OAuth login in ZCode
4. Capture all requests/responses
5. Extract: token endpoint, request format, response format, scopes

### Option C: Test with 9router Directly
1. Implement OAuth initiate route in 9router
2. Test authorization flow end-to-end
3. Debug any errors
4. Capture actual token response

---

## 📚 References

- ZCode Documentation: https://zcode.z.ai/en/docs/configuration
- ZCode Version: 3.1.0 Linux x64
- OAuth 2.0 Spec: https://datatracker.ietf.org/doc/html/rfc6749
- Anthropic API (format used by Z.ai): https://docs.anthropic.com/

---

## 🎯 Key Takeaway

**OAuth tokens are USER-SPECIFIC, not application-wide!**

- client_id identifies the APPLICATION (ZCode/9router)
- access_token identifies the USER
- Each user gets their own unique tokens
- 9router must store and manage tokens per user
- Tokens are obtained through the OAuth authorization flow
