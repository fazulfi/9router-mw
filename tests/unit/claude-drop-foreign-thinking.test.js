import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../open-sse/config/defaultThinkingSignature.js";

function makeValidClaudeSignature() {
  // The real default thinking signature is an E-form signature whose decoded
  // bytes start with Claude marker 0x12.
  return DEFAULT_THINKING_CLAUDE_SIGNATURE;
}

function makeForeignSignature() {
  // Starts with E (so it is inspected) but the decoded first byte is not 0x12.
  return "EA" + Buffer.from([0x00, 0x11, 0x22, 0x33]).toString("base64");
}

describe("normalizeClaudePassthrough — drop foreign thinking signatures (cd557a25)", () => {
  it("keeps thinking blocks with a valid Claude signature", () => {
    const sig = makeValidClaudeSignature();
    const body = {
      thinking: { type: "enabled" },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan", signature: sig },
            { type: "text", text: "ok" }
          ]
        }
      ]
    };
    normalizeClaudePassthrough(body);
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[0]).toEqual({ type: "thinking", thinking: "plan", signature: sig });
  });

  it("drops thinking blocks with a foreign/invalid signature", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "foreign plan", signature: makeForeignSignature() },
            { type: "text", text: "ok" }
          ]
        }
      ]
    };
    normalizeClaudePassthrough(body);
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0].type).toBe("text");
  });

  it("re-inserts a placeholder thinking block when tool_use follows a dropped foreign signature", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "foreign", signature: makeForeignSignature() },
            { type: "tool_use", id: "t1", name: "x", input: {} }
          ]
        }
      ]
    };
    normalizeClaudePassthrough(body);
    const content = body.messages[0].content;
    expect(content[0].type).toBe("thinking");
    expect(content[0].thinking).toBe(".");
    expect(content[content.length - 1].type).toBe("tool_use");
  });

  it("does not insert placeholder when thinking is not enabled", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "foreign", signature: makeForeignSignature() },
            { type: "tool_use", id: "t1", name: "x", input: {} }
          ]
        }
      ]
    };
    normalizeClaudePassthrough(body);
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0].type).toBe("tool_use");
  });

  it("does not insert placeholder when a valid thinking block is kept", () => {
    const sig = makeValidClaudeSignature();
    const body = {
      thinking: { type: "enabled" },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "own plan", signature: sig },
            { type: "tool_use", id: "t1", name: "x", input: {} }
          ]
        }
      ]
    };
    normalizeClaudePassthrough(body);
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[0].signature).toBe(sig);
  });
});
