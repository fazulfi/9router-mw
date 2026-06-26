# Live Smoke Results — Kimi Harness Maximization

Endpoint: `http://localhost:20127`  
API key: `sk-3f68432058f6317c-f5afxg-81892e14`  
Date: 2026-06-26

## Summary

All three required live smoke cases completed successfully after the alias change (`ki` → `kimchi`) and NVIDIA registry alignment:

| # | Case | Model | Status | Notes |
|---|------|-------|--------|-------|
| 1 | Kimchi K2.7 first-turn | `kimchi/kimi-k2.7` | ✅ OK | Non-streaming JSON response; HTTP 200. |
| 2 | Kimchi K2.6 multi-turn loop | `kimchi/kimi-k2.6` | ✅ OK | Multi-turn exchange returned HTTP 200 and terminated cleanly. |
| 3 | NVIDIA Kimi K2.6(high) stream | `nvidia/moonshotai/kimi-k2.6(high)` | ✅ OK | Client `stream:true` returned SSE chunks + `[DONE]`; upstream coercion transparent. |

## Test 1 — Kimchi K2.7 first-turn (non-streaming)

Request:

```json
POST /api/v1/chat/completions
{
  "model": "kimchi/kimi-k2.7",
  "messages": [{"role":"user","content":"Say the exact word pong and nothing else."}],
  "stream": false,
  "max_tokens": 50
}
```

Result: HTTP 200, JSON body saved to `.docs/audit/smoke-k2.7.json`.

Key observations:
- `finish_reason`: `stop` (after reaching the model's own stop condition)
- `message.content`: the model explained it would respond with only "pong"
- `provider_specific_fields.matched_stop`: present
- No leaked native tool-call markup in `content`
- No `tool_calls` array

## Test 2 — Kimchi K2.6 multi-turn loop (non-streaming)

Request:

```json
POST /api/v1/chat/completions
{
  "model": "kimchi/kimi-k2.6",
  "messages": [
    {"role":"system","content":"You are a concise assistant."},
    {"role":"user","content":"Count to 2."},
    {"role":"assistant","content":"1, 2."},
    {"role":"user","content":"Now count to 3."}
  ],
  "stream": false,
  "max_tokens": 50
}
```

Result: HTTP 200, JSON body saved to `.docs/audit/smoke-k2.6-loop.json`.

Key observations:
- Multi-turn context was preserved across user/assistant turns
- Response finished cleanly (no repeated/tool markup output)
- Usage reported in response

## Test 3 — NVIDIA Kimi K2.6(high) streaming

Request:

```json
POST /api/v1/chat/completions
{
  "model": "nvidia/moonshotai/kimi-k2.6(high)",
  "messages": [{"role":"user","content":"Say pong."}],
  "stream": true,
  "max_tokens": 50
}
```

Result: HTTP 200 streaming, raw SSE saved to `.docs/audit/smoke-nvidia-k2.6-high.txt`.

Key observations:
- Stream opened and emitted standard `data:` chunks
- Final chunks included usage-only chunk and `[DONE]` terminator
- Upstream coercion `stream:true → stream:false` is transparent to the client
- Upstream model reported as `moonshotai/kimi-k2.6`

## Artifacts

- `.docs/audit/smoke-k2.7.json`
- `.docs/audit/smoke-k2.6-loop.json`
- `.docs/audit/smoke-nvidia-k2.6-high.txt`
