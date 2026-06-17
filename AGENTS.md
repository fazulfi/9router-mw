# 9router AI Agent Instructions

## Knowledge Base (Obsidian Vault)

**ALWAYS check the Obsidian vault first for 9router/ZCode knowledge:**

- **Vault path**: `~/Documents/9router-knowledge/`
- **Master file**: `~/Documents/9router-knowledge/ZCODE-KNOWLEDGE-FULL.md`
- **Open vault**: `obsidian ~/Documents/9router-knowledge`
- **Sync helper**: `obs-vault-sync [pull|push|status]`

### Vault Structure
```
~/Documents/9router-knowledge/
├── INDEX.md                    # Wiki-link index
├── Overview.md                 # System overview
├── ZCODE-KNOWLEDGE-FULL.md     # Master single-source-of-truth (mirrors /media/DiskE/Code/9router/ZCODE_KNOWLEDGE.md)
├── ZCode-Architecture.md       # App structure, IPC, storage
├── ZCode-Plan-Endpoint.md      # Endpoint, error codes, WAF routing
├── ZCode-Captcha.md            # Aliyun captcha solving
├── ZCode-Auth-Flow.md          # OAuth, tokens, JWT
├── Test-Results.md             # All test results
├── Code-Reference.md           # Function names, line numbers
└── 9router-Integration.md      # Integration plan & status
```

### Rules
1. **Read from Obsidian vault FIRST** before working on 9router/ZCode tasks
2. **Update both** `/media/DiskE/Code/9router/ZCODE_KNOWLEDGE.md` AND `~/Documents/9router-knowledge/ZCODE-KNOWLEDGE-FULL.md` when new info is found
3. Use `obs-vault-sync pull` to copy from 9router → vault
4. Use `obs-vault-sync push` to copy from vault → 9router
5. Use `obs-vault-sync status` to check sync state

### Key Findings (Quick Reference)
- Plan endpoint: `https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages`
- Auth: `Authorization: Bearer <zcodeJwtToken>` (NOT x-api-key)
- Captcha headers: `X-Aliyun-Captcha-Verify-Param` + `X-Aliyun-Captcha-Verify-Region: sgp`
- Anti-detection: Chrome UA + `navigator.webdriver=undefined` + mouse moves
- Models: `GLM-5.2` (3M/day), `GLM-5-Turbo` (2M/day)
- 9router dev port: 9000
- Executors path: `open-sse/executors/zcode.js`
- Provider config: `open-sse/config/providers.js:140`

### Current Blockers
- Messages API returns 3001 (parameter error) for all body format variations
- WAF body-shape routing: system:array→3012, content:array→3012, content:string→3001
- ZCode desktop WORKS on same endpoint (187 successful requests in log)
- Need exact body format ZCode sends

### Error Code Map
- 200 = success
- 3001 = parameter error (past WAF+auth+captcha, endpoint rejects)
- 3007 = captcha verify failed
- 3012 = method not allowed (WAF body-shape reject)
- 401 = token invalid
