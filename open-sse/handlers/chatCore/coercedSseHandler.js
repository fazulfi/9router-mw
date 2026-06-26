import { SSE_HEADERS_CORS } from "../../utils/sseConstants.js";

const encoder = new TextEncoder();

/**
 * Convert a non-streaming chat.completion JSON into a synthetic SSE stream.
 * Used when upstream was coerced to stream:false but the client expects SSE.
 * Returns a Response with SSE headers.
 */
export function buildCoercedSSEResponse(jsonResponse) {
  const choice = jsonResponse?.choices?.[0];
  const msg = choice?.message;

  if (!msg) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(jsonResponse)}\n\ndata: [DONE]\n\n`));
        controller.close();
      }
    });
    return new Response(stream, { headers: SSE_HEADERS_CORS });
  }

  const id = jsonResponse.id || `chatcmpl-${Date.now()}`;
  const created = jsonResponse.created || Math.floor(Date.now() / 1000);
  const model = jsonResponse.model || "unknown";

  const chunks = [];

  // 1. Role delta
  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }]
  });

  // 2. Reasoning content delta (if present)
  if (msg.reasoning_content) {
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { reasoning_content: msg.reasoning_content }, finish_reason: null, logprobs: null }]
    });
  }

  // 3. Content delta
  if (msg.content) {
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: msg.content }, finish_reason: null, logprobs: null }]
    });
  }

  // 4. Tool calls delta (emit complete array)
  if (msg.tool_calls?.length > 0) {
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { tool_calls: msg.tool_calls }, finish_reason: null, logprobs: null }]
    });
  }

  // 5. Finish chunk (with usage if available)
  const finishReason = choice.finish_reason || "stop";
  const finishChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason, logprobs: null }]
  };
  if (jsonResponse.usage) {
    finishChunk.usage = jsonResponse.usage;
  }
  chunks.push(finishChunk);

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return new Response(stream, { headers: SSE_HEADERS_CORS });
}
