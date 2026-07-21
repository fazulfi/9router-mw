import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

const translate = (body) => openaiResponsesToOpenAIRequest("claude-fable-5", body, true, null);

describe("Responses custom tool request translation", () => {
  it("wraps custom declarations and records their names", () => {
    const out = translate({
      input: "Apply the patch.",
      tools: [{
        type: "custom",
        name: "apply_patch",
        description: "Apply a patch",
        format: { type: "text" },
      }],
    });

    expect(out.tools).toEqual([{
      type: "function",
      function: {
        name: "apply_patch",
        description: "Apply a patch",
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
    }]);
    expect(out._customToolNames).toEqual(new Set(["apply_patch"]));
  });

  it("converts custom call and output history to Chat tool messages", () => {
    const out = translate({
      input: [
        {
          type: "custom_tool_call",
          call_id: "call_patch",
          name: "apply_patch",
          input: "*** Begin Patch",
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_patch",
          output: "Done!",
        },
      ],
    });

    expect(out.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_patch",
          type: "function",
          function: {
            name: "apply_patch",
            arguments: "{\"input\":\"*** Begin Patch\"}",
          },
        }],
      },
      { role: "tool", tool_call_id: "call_patch", content: "Done!" },
    ]);
  });

  it("leaves ordinary function declarations and history unchanged", () => {
    const parameters = {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    };
    const out = translate({
      input: [
        {
          type: "function_call",
          call_id: "call_read",
          name: "read_file",
          arguments: "{\"path\":\"README.md\"}",
        },
        {
          type: "function_call_output",
          call_id: "call_read",
          output: "contents",
        },
      ],
      tools: [{
        type: "function",
        name: "read_file",
        description: "Read a file",
        parameters,
        strict: true,
      }],
    });

    expect(out.tools).toEqual([{
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters,
        strict: true,
      },
    }]);
    expect(out.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_read",
          type: "function",
          function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" },
        }],
      },
      { role: "tool", tool_call_id: "call_read", content: "contents" },
    ]);
    expect(out._customToolNames).toEqual(new Set());
  });

  it("stringifies malformed custom input and non-string outputs", () => {
    const out = translate({
      input: [
        {
          type: "custom_tool_call",
          call_id: "call_object",
          name: "apply_patch",
          input: { patch: "text" },
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_object",
          output: { ok: true },
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_missing",
        },
      ],
    });

    expect(out.messages[0].tool_calls[0].function.arguments)
      .toBe("{\"input\":\"{\\\"patch\\\":\\\"text\\\"}\"}");
    expect(out.messages.slice(1)).toEqual([
      { role: "tool", tool_call_id: "call_object", content: "{\"ok\":true}" },
      { role: "tool", tool_call_id: "call_missing", content: "null" },
    ]);
  });
});
