# Kimchi CLI Reference — Kimi K2.6 / K2.7 Request Shapes

> Captured from the official Moonshot AI Kimi CLI (`@moonshot-ai/kimi-code` v0.20.0)
> and its public provider catalog (`https://models.dev/api.json`).
> Installation path: `/media/DiskE/Code/9router/.fakehome/.local/bin/kimi`

## 1. CLI Distribution

| Item | Value |
|------|-------|
| Package | `@moonshot-ai/kimi-code` |
| Binary | `kimi` |
| Version | `0.20.0` |
| Install command | `npm install -g --prefix /media/DiskE/Code/9router/.fakehome/.local @moonshot-ai/kimi-code` |
| Provider catalog | `https://models.dev/api.json` |
| Moonshot base URL | `https://api.moonshot.ai/v1` |
| Wire format | OpenAI-compatible (`@ai-sdk/openai-compatible`) |

## 2. Kimi Models in the CLI Catalog

The CLI exposes these Moonshot models (relevant subset):

| Model ID | Family | Reasoning | Tool call | Attachment | Temperature | Context | Output |
|----------|--------|-----------|-----------|------------|-------------|---------|--------|
| `kimi-k2.6` | `kimi-k2` | yes | yes | yes | yes | 262144 | **16384** |
| `kimi-k2.7` (implied) | `kimi-k2` | yes | yes | yes | yes | 262144 | ? |
| `kimi-k2.7-code` | `kimi-k2` | yes | yes | yes | **no** | 262144 | **262144** |
| `kimi-k2.7-code-highspeed` | `kimi-k2` | yes | yes | yes | yes | 262144 | 262144 |
| `kimi-k2-thinking` | `kimi-thinking` | yes | yes | no | yes | 262144 | 262144 |
| `kimi-k2-thinking-turbo` | `kimi-thinking` | yes | yes | no | yes | 262144 | 262144 |
| `kimi-k2.5` | `kimi-k2` | yes | yes | yes | yes | 262144 | 32768 |
| `kimi-k2-0905-preview` | `kimi-k2` | no | yes | no | yes | 262144 | 262144 |
| `kimi-k2-0711-preview` | `kimi-k2` | no | yes | no | yes | 131072 | 131072 |

Key capability flags:

- `interleaved: { field: "reasoning_content" }` — reasoning content is returned
  interleaved in the OpenAI-compatible `reasoning_content` field.
- `structured_output: true/false` — whether JSON-mode / structured output is
  advertised.
- `temperature: false` — **only `kimi-k2.7-code`** disables temperature.

## 3. Raw Request Shape

Because the CLI uses `@ai-sdk/openai-compatible` against
`https://api.moonshot.ai/v1`, the upstream request is a standard OpenAI chat
completion:

```http
POST /v1/chat/completions
Authorization: Bearer $MOONSHOT_API_KEY
Content-Type: application/json

{
  "model": "kimi-k2.6",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 16384
}
```

Streaming uses SSE (`data:` lines) with the standard
`chat.completion.chunk` schema.

For **tool calls**, the CLI sends the standard OpenAI `tools`/`tool_choice`
schema; it does not emit the leaked `functions.NAME:ID {JSON}` markup that
9router’s native Kimi markup parser was added to handle.

## 4. Discrepancies with 9router (Measurable)

1. **`max_tokens` ceiling for NVIDIA-hosted Kimi K2.6**
   - CLI catalog output limit for `kimi-k2.6`: **16384** tokens.
   - 9router currently clamps NVIDIA Kimi `max_tokens` to **8192** tokens.
   - The audit comment says degeneration starts at "very large (>=~32k)".
   - A 16384 ceiling matches the CLI-published limit and still stays well below
     the observed degeneration threshold.

2. **Temperature support for `kimi-k2.7-code`**
   - CLI catalog marks `kimi-k2.7-code` as `temperature: false`.
   - 9router has no per-model temperature suppression; it would forward the
     client `temperature` value unchanged.

3. **Reasoning content field**
   - CLI catalog explicitly marks `interleaved: { field: "reasoning_content" }`
     for reasoning models.
   - 9router already routes `reasoning_content` via the audit patch in
     `thinkingUnified.js` (protected file), so this is already aligned.

## 5. Recommended CLI-Derived Improvement

Apply discrepancy #1: raise the NVIDIA Kimi K2.6 `max_tokens` clamp from 8192
 to **16384** to match the official CLI-published output limit, while keeping
 the protection against >32k degeneration. Update
 `tests/unit/kimi-max-tokens.test.js` accordingly.
