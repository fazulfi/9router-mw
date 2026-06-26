import { describe, it, expect } from "vitest";
import {
  hasKimiToolMarkup,
  splitKimiToolRegion,
  parseJsonObject,
  parseKimiToolCallFragment,
  extractKimiToolCalls,
  parseKimiToolCalls,
  normalizeKimiToolCalls,
} from "../../open-sse/utils/kimiToolParser.js";
import { createSSETransformStreamWithLogger, buildOpenAIToolCallsChunk, emitKimiToolCallsChunk } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("hasKimiToolMarkup", () => {
  it("detects native Kimi markup", () => {
    expect(hasKimiToolMarkup('functions.bash:0 {"command":"echo hi"}')).toBe(true);
  });

  it("returns false for normal prose", () => {
    expect(hasKimiToolMarkup("Hello world")).toBe(false);
  });

  it("returns false for empty / null / non-string content", () => {
    expect(hasKimiToolMarkup("")).toBe(false);
    expect(hasKimiToolMarkup(null)).toBe(false);
    expect(hasKimiToolMarkup(undefined)).toBe(false);
    expect(hasKimiToolMarkup(123)).toBe(false);
  });

  it("detects markup embedded after prose", () => {
    expect(hasKimiToolMarkup('Let me check functions.bash:0 {"command":"ls"}')).toBe(true);
  });

  it("detects markup with control tokens preserved", () => {
    expect(hasKimiToolMarkup('  functions.bash:0 {"command":"ls"}  functions.bash:1 {"command":"pwd"}  ')).toBe(true);
  });
});

describe("splitKimiToolRegion", () => {
  it("splits leading prose from tool region", () => {
    const { prefix, tail } = splitKimiToolRegion('I will run it functions.bash:0 {"command":"ls"}');
    expect(prefix).toBe("I will run it");
    expect(tail).toBe('functions.bash:0 {"command":"ls"}');
  });

  it("returns original content as prefix when no markup", () => {
    const { prefix, tail } = splitKimiToolRegion("Just prose");
    expect(prefix).toBe("Just prose");
    expect(tail).toBe("");
  });

  it("trims leading whitespace from prefix", () => {
    const { prefix, tail } = splitKimiToolRegion('   functions.bash:0 {"command":"ls"}');
    expect(prefix).toBe("");
    expect(tail).toBe('functions.bash:0 {"command":"ls"}');
  });
});

describe("parseJsonObject", () => {
  it("parses a flat object", () => {
    expect(parseJsonObject('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("parses nested objects", () => {
    expect(parseJsonObject('{"outer":{"inner":true}}')).toEqual({ outer: { inner: true } });
  });

  it("respects quoted braces", () => {
    expect(parseJsonObject('{"cmd":"echo {a,b}","x":1}')).toEqual({ cmd: "echo {a,b}", x: 1 });
  });

  it("respects escaped quotes", () => {
    expect(parseJsonObject('{"cmd":"echo \\"hi\\""}')).toEqual({ cmd: 'echo "hi"' });
  });

  it("stops after the first balanced object", () => {
    const obj = parseJsonObject('{"a":1}{"b":2}');
    expect(obj).toEqual({ a: 1 });
  });

  it("throws on unbalanced input", () => {
    expect(() => parseJsonObject('{"a":1')).toThrow();
  });
});

describe("parseKimiToolCallFragment", () => {
  it("parses a fragment with id", () => {
    const call = parseKimiToolCallFragment('bash:0 {"command":"echo hi"}', 0);
    expect(call).toMatchObject({
      id: "functions.bash:0",
      type: "function",
      function: {
        name: "bash",
        arguments: JSON.stringify({ command: "echo hi" }),
      },
    });
  });

  it("uses the index as id when omitted", () => {
    const call = parseKimiToolCallFragment('bash {"command":"echo hi"}', 7);
    expect(call.id).toBe("functions.bash:7");
  });

  it("parses tool names with dots and hyphens", () => {
    const call = parseKimiToolCallFragment('my-tool.v2:abc {"x":1}', 0);
    expect(call.function.name).toBe("my-tool.v2");
    expect(call.id).toBe("functions.my-tool.v2:abc");
  });

  it("returns null when JSON is missing", () => {
    expect(parseKimiToolCallFragment("bash:0 no json", 0)).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    expect(parseKimiToolCallFragment('bash:0 {"broken"}', 0)).toBeNull();
  });

  it("returns null for malformed header", () => {
    expect(parseKimiToolCallFragment('bad name:0 {"x":1}', 0)).toBeNull();
  });

  it("parses underscore tool names", () => {
    const call = parseKimiToolCallFragment('my_tool:1 {"x":1}', 0);
    expect(call.function.name).toBe("my_tool");
  });

  it("parses empty JSON arguments", () => {
    const call = parseKimiToolCallFragment('noop:0 {}', 0);
    expect(call.function.arguments).toBe("{}");
  });
});

describe("extractKimiToolCalls", () => {
  it("extracts a single call", () => {
    const calls = extractKimiToolCalls('functions.bash:0 {"command":"echo hi"}');
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("bash");
  });

  it("extracts multiple consecutive calls", () => {
    const calls = extractKimiToolCalls(
      'functions.bash:0 {"command":"ls"}functions.read:1 {"path":"README.md"}functions.bash:2 {"command":"pwd"}'
    );
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.function.name)).toEqual(["bash", "read", "bash"]);
    expect(calls[1].id).toBe("functions.read:1");
  });

  it("ignores leading prose", () => {
    const calls = extractKimiToolCalls(
      'I will search functions.web_search:0 {"query":"vitest"}'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("web_search");
  });

  it("returns empty array when no markup", () => {
    expect(extractKimiToolCalls("no tools here")).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractKimiToolCalls("")).toEqual([]);
  });

  it("stops parsing when a fragment is malformed", () => {
    const calls = extractKimiToolCalls(
      'functions.bash:0 {"command":"ls"}functions.broken no json'
    );
    expect(calls).toHaveLength(1);
  });

  it("handles nested JSON arguments", () => {
    const calls = extractKimiToolCalls(
      'functions.complex:0 {"outer":{"inner":[1,2,3]},"flag":true}'
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      outer: { inner: [1, 2, 3] },
      flag: true,
    });
  });

  it("preserves argument string exactly as JSON", () => {
    const args = '{"command":"echo \\"=== PROJECTS ===\\" && ls -d */"}';
    const calls = extractKimiToolCalls(`functions.bash:0 ${args}`);
    expect(calls[0].function.arguments).toBe(args);
  });

  it("caps extraction at MAX_CALLS", () => {
    const repeated = Array(100).fill('functions.bash:0 {"command":"x"}').join("");
    const calls = extractKimiToolCalls(repeated);
    expect(calls.length).toBe(64);
  });
});

describe("parseKimiToolCalls", () => {
  it("returns tool_calls array for markup", () => {
    const calls = parseKimiToolCalls('functions.bash:0 {"command":"ls"}');
    expect(Array.isArray(calls)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("returns null when no markup", () => {
    expect(parseKimiToolCalls("plain text")).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(parseKimiToolCalls("")).toBeNull();
  });

  it("returns null for non-string content", () => {
    expect(parseKimiToolCalls(null)).toBeNull();
    expect(parseKimiToolCalls(undefined)).toBeNull();
    expect(parseKimiToolCalls(42)).toBeNull();
  });
});

describe("normalizeKimiToolCalls", () => {
  it("moves leaked markup into tool_calls and trims content", () => {
    const message = {
      role: "assistant",
      content: 'Let me check functions.bash:0 {"command":"free -h"}',
      tool_calls: null,
    };
    const result = normalizeKimiToolCalls(message);
    expect(result.hasTools).toBe(true);
    expect(result.message.content).toBe("Let me check");
    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.tool_calls[0].function.name).toBe("bash");
    expect(result.originalContent).toBe(message.content);
  });

  it("sets content to empty string when markup starts immediately", () => {
    const message = {
      role: "assistant",
      content: 'functions.bash:0 {"command":"ls"}',
    };
    const result = normalizeKimiToolCalls(message);
    expect(result.message.content).toBe("");
    expect(result.message.tool_calls).toHaveLength(1);
  });

  it("leaves already-structured tool_calls untouched", () => {
    const message = {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: "{}" } }],
    };
    const result = normalizeKimiToolCalls(message);
    expect(result.hasTools).toBe(true);
    expect(result.message.content).toBe("");
    expect(result.message.tool_calls).toEqual(message.tool_calls);
  });

  it("passes through messages without markup", () => {
    const message = { role: "assistant", content: "Just saying hello" };
    const result = normalizeKimiToolCalls(message);
    expect(result.hasTools).toBe(false);
    expect(result.message).toEqual(message);
    expect(result.message.tool_calls).toBeUndefined();
  });

  it("handles empty JSON arguments", () => {
    const result = normalizeKimiToolCalls({
      role: "assistant",
      content: 'functions.noop:0 {}',
    });
    expect(result.hasTools).toBe(true);
    expect(result.message.tool_calls[0].function.arguments).toBe("{}");
  });

  it("handles content with only whitespace before markup", () => {
    const result = normalizeKimiToolCalls({
      role: "assistant",
      content: '   functions.bash:0 {"command":"ls"}',
    });
    expect(result.message.content).toBe("");
    expect(result.hasTools).toBe(true);
  });

  it("returns safe metadata when called with null", () => {
    const result = normalizeKimiToolCalls(null);
    expect(result.hasTools).toBe(false);
    expect(result.originalContent).toBe("");
  });

  it("matches the real-world Kimchi example from the audit doc", () => {
    const rawArgs =
      '{"command": "echo \\"=== PROJECTS ===\\" && ls -d */ 2>/dev/null || echo \\"No project dirs\\" && echo && echo \\"=== RAM ===\\" && free -h 2>/dev/null || vm_stat 2>/dev/null || cat /proc/meminfo 2>/dev/null | head -5"}';
    const content = `  functions.bash:0 ${rawArgs}  `;
    const result = normalizeKimiToolCalls({ role: "assistant", content });
    expect(result.hasTools).toBe(true);
    expect(result.message.content).toBe("");
    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.tool_calls[0]).toMatchObject({
      id: "functions.bash:0",
      type: "function",
      function: { name: "bash" },
    });
    expect(JSON.parse(result.message.tool_calls[0].function.arguments)).toEqual(
      JSON.parse(rawArgs)
    );
  });
});

async function collectSSE(stream) {
  const decoder = new TextDecoder();
  const chunks = [];
  await stream.pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      },
    })
  );
  return chunks.join("");
}

function encodeSSE(text) {
  return new TextEncoder().encode(text);
}

describe("streaming helpers", () => {
  it("buildOpenAIToolCallsChunk returns a valid OpenAI SSE chunk", () => {
    const chunk = buildOpenAIToolCallsChunk(
      [{ id: "functions.bash:0", type: "function", function: { name: "bash", arguments: "{\"x\":1}" } }],
      "msg_123",
      "kimchi/kimi-k2.7"
    );
    expect(chunk.object).toBe("chat.completion.chunk");
    expect(chunk.model).toBe("kimchi/kimi-k2.7");
    expect(chunk.choices[0].finish_reason).toBe("tool_calls");
    expect(chunk.choices[0].delta.tool_calls).toHaveLength(1);
    expect(chunk.id).toBe("chatcmpl-msg_123");
  });

  it("emitKimiToolCallsChunk enqueues encoded SSE output for OpenAI", () => {
    const enqueued = [];
    const controller = {
      enqueue(value) { enqueued.push(value); }
    };
    const emitted = emitKimiToolCallsChunk(
      controller,
      [{ id: "functions.bash:0", type: "function", function: { name: "bash", arguments: "{\"x\":1}" } }],
      { messageId: "msg_123" },
      "kimchi/kimi-k2.7",
      FORMATS.OPENAI,
      null
    );
    expect(emitted).toBe(true);
    expect(enqueued.length).toBe(1);
    const decoded = new TextDecoder().decode(enqueued[0]);
    expect(decoded).toContain('"finish_reason":"tool_calls"');
    expect(decoded).toContain('"tool_calls"');
  });

  it("emitKimiToolCallsChunk is a no-op for non-OpenAI formats", () => {
    const controller = { enqueue: () => { throw new Error("should not be called"); } };
    const emitted = emitKimiToolCallsChunk(controller, [{ id: "x", type: "function", function: { name: "bash", arguments: "{}" } }], null, "m", FORMATS.CLAUDE, null);
    expect(emitted).toBe(false);
  });

  it("createSSETransformStreamWithLogger accepts normalizeKimiToolCalls and closes cleanly", async () => {
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "kimchi",
      null,
      null,
      "kimchi/kimi-k2.7",
      null,
      null,
      null,
      null,
      normalizeKimiToolCalls
    );
    const writer = transform.writable.getWriter();
    const outputPromise = collectSSE(transform.readable);
    await writer.write(encodeSSE('data: {"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n'));
    await writer.close();
    const output = await outputPromise;
    expect(output).toContain("hello");
  });
});
