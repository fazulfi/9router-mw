import { describe, it, expect } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

// isBodyEmpty is module-private, tested indirectly through handleComboChat

const fakeLog = { info: () => {}, warn: () => {}, error: () => {} };

function okResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VALID_BODY = { choices: [{ message: { content: "hello" } }] };

describe("combo empty 200 response handling", () => {
  it("returns immediately when first model returns valid body", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/model-1", "a/model-2"],
      handleSingleModel: async () => {
        calls++;
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-valid",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("hello");
    expect(calls).toBe(1);
  });

  it("returns empty 200 as-is (no retry for empty body)", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/model-1"],
      handleSingleModel: async () => {
        calls++;
        return okResponse({});
      },
      log: fakeLog,
      comboName: "combo-empty-obj",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json).toEqual({});
    expect(calls).toBe(1); // 200 accepted immediately, no retry
  });

  it("returns empty choices 200 as-is (no retry)", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/model-1"],
      handleSingleModel: async () => {
        calls++;
        return okResponse({ choices: [] });
      },
      log: fakeLog,
      comboName: "combo-empty-choices",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(1); // 200 accepted immediately, no retry
  });

  it("returns empty 200 from first model (no fallback)", async () => {
    const callLog = [];
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/flaky", "a/stable"],
      handleSingleModel: async (body, model) => {
        callLog.push(model);
        if (model === "a/flaky") return okResponse({}); // 200 returned immediately
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-fallback",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json).toEqual({}); // empty response passes through
    expect(callLog).toEqual(["a/flaky"]); // no fallback, first 200 wins
  });

  it("returns first 200 empty response as ok", async () => {
    // Empty 200 responses are returned as-is (no empty-body detection)
    const thatLog = { info: () => {}, warn: () => {}, error: () => {} };
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-1", "a/empty-2"],
      handleSingleModel: async () => okResponse({}),
      log: thatLog,
      comboName: "combo-all-empty",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true); // 200 is ok regardless of body content
    const json = await result.json();
    expect(json).toEqual({});
  });

  it("handles empty string body (not JSON) as-is", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-str", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/empty-str") return new Response("", { status: 200 });
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-str",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(1); // first 200 passes through
  });

  it("handles choices with empty message content (passes through)", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-msg", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        return okResponse({ choices: [{ message: { content: "" } }] });
      },
      log: fakeLog,
      comboName: "combo-empty-content",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe(""); // empty content passes through
    expect(calls).toBe(1);
  });

  it("handles choices with empty message object (passes through)", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-msg-obj", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        return okResponse({ choices: [{ message: {} }] });
      },
      log: fakeLog,
      comboName: "combo-empty-msg-obj",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(1); // first 200 passes through immediately
  });

  it("handles empty array body", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-arr", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/empty-arr") return okResponse([]);
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-arr",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
  });

  it("does not retry 200 responses even with delta-only body", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/recovers"],
      handleSingleModel: async () => {
        calls++;
        return okResponse({ choices: [{ delta: {}, finish_reason: null }] });
      },
      log: fakeLog,
      comboName: "combo-recovers",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(1); // 200 accepted immediately, no retry
  });

  it("does not retry streaming responses (text() throws, treated as valid)", async () => {
    // Streaming Response throws when .text() is called on a locked body.
    // isBodyEmpty catches and returns false — no retry.
    let calls = 0;
    // Use a ReadableStream body that can be consumed to simulate streaming
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/streaming"],
      handleSingleModel: async () => {
        calls++;
        return new Response(streamBody, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
      log: fakeLog,
      comboName: "combo-streaming",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    // Streaming body consumed once by .clone().text() internally,
    // then returned — only 1 call, no retry triggered.
    expect(calls).toBe(1);
  });
});
