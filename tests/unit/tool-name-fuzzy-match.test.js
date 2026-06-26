import { describe, expect, it } from "vitest";
import { extractToolNames, fuzzyMatchToolName } from "../../open-sse/translator/concerns/toolCall.js";

describe("extractToolNames", () => {
  it("extracts OpenAI-format function names", () => {
    expect(extractToolNames([
      { type: "function", function: { name: "read" } },
      { type: "function", function: { name: "edit" } },
    ])).toEqual(["read", "edit"]);
  });

  it("extracts generic names when no function wrapper", () => {
    expect(extractToolNames([
      { name: "bash" },
      { name: "grep" },
    ])).toEqual(["bash", "grep"]);
  });

  it("skips entries without a valid string name", () => {
    expect(extractToolNames([
      { function: { name: "read" } },
      { function: {} },
      { function: { name: "" } },
      { function: { name: 123 } },
      null,
    ])).toEqual(["read"]);
  });

  it("returns [] for non-array input", () => {
    expect(extractToolNames(null)).toEqual([]);
    expect(extractToolNames(undefined)).toEqual([]);
    expect(extractToolNames({})).toEqual([]);
  });
});

describe("fuzzyMatchToolName", () => {
  const tools = ["read", "edit", "write", "bash", "web_search", "bevan-tools_search"];

  it("returns exact match unchanged", () => {
    expect(fuzzyMatchToolName("read", tools)).toBe("read");
    expect(fuzzyMatchToolName("bash", tools)).toBe("bash");
  });

  it("fixes case-insensitive exact match while preserving original-cased valid name", () => {
    expect(fuzzyMatchToolName("READ", tools)).toBe("read");
    expect(fuzzyMatchToolName("Edit", tools)).toBe("edit");
  });

  // ── the actual reported failure mode ──────────────────────────────────

  it("strips 'functions' prefix concatenation", () => {
    expect(fuzzyMatchToolName("functionsread", tools)).toBe("read");
    expect(fuzzyMatchToolName("functionsedit", tools)).toBe("edit");
    expect(fuzzyMatchToolName("functionsbash", tools)).toBe("bash");
  });

  it("strips 'functions.' (dot) prefix", () => {
    expect(fuzzyMatchToolName("functions.read", tools)).toBe("read");
    expect(fuzzyMatchToolName("functions.edit", tools)).toBe("edit");
  });

  it("strips 'function' prefix (no trailing s)", () => {
    expect(fuzzyMatchToolName("functionread", tools)).toBe("read");
  });

  it("strips 'tools.' prefix", () => {
    expect(fuzzyMatchToolName("tools.read", tools)).toBe("read");
  });

  it("strips 'tool.' prefix (no trailing s)", () => {
    expect(fuzzyMatchToolName("tool.read", tools)).toBe("read");
  });

  it("strips 'funcs.' prefix", () => {
    expect(fuzzyMatchToolName("funcs.read", tools)).toBe("read");
  });

  it("strips 'fn.' prefix", () => {
    expect(fuzzyMatchToolName("fn.read", tools)).toBe("read");
  });

  it("strips 'mcp__' prefix", () => {
    expect(fuzzyMatchToolName("mcp__read", tools)).toBe("read");
  });

  it("strips underscored variants (functions_, tool_)", () => {
    expect(fuzzyMatchToolName("functions_read", tools)).toBe("read");
    expect(fuzzyMatchToolName("tool_read", tools)).toBe("read");
  });

  it("strips slash variants (functions/, tool/)", () => {
    expect(fuzzyMatchToolName("functions/read", tools)).toBe("read");
    expect(fuzzyMatchToolName("tool/read", tools)).toBe("read");
  });

  // ── safety: never mangle valid tool names or confidently reject junk ──

  it("leaves exact match alone even if a substring match would also work", () => {
    expect(fuzzyMatchToolName("read", ["read_file", "read"])).toBe("read");
  });

  it("returns candidate unchanged when no confident match exists", () => {
    expect(fuzzyMatchToolName("completely_unknown_tool", tools)).toBe("completely_unknown_tool");
  });

  it("returns candidate when it is suspiciously short to avoid false positives", () => {
    // 2-char candidates have too high a chance of accidentally matching; skip.
    expect(fuzzyMatchToolName("xy", tools)).toBe("xy");
  });

  it("returns candidate when length difference is too large for substring match", () => {
    // tool name is 3 chars but candidate is 30 chars — too dissimilar
    expect(fuzzyMatchToolName("bash_extra_stuff_appended_to_make_it_long", tools)).toBe(
      "bash_extra_stuff_appended_to_make_it_long"
    );
  });

  // ── defensive: invalid inputs ─────────────────────────────────────────

  it("returns candidate for empty/null validToolNames", () => {
    expect(fuzzyMatchToolName("functionsread", null)).toBe("functionsread");
    expect(fuzzyMatchToolName("functionsread", [])).toBe("functionsread");
  });

  it("returns candidate for empty/non-string input", () => {
    expect(fuzzyMatchToolName("", tools)).toBe("");
    expect(fuzzyMatchToolName(null, tools)).toBe(null);
    expect(fuzzyMatchToolName(undefined, tools)).toBe(undefined);
  });

  // ── substring fallback (length-constrained) ───────────────────────────

  it("falls back to substring match when prefix-stripping fails", () => {
    // candidate "search" is a substring of "web_search"
    expect(fuzzyMatchToolName("search", ["web_search", "read"])).toBe("web_search");
  });

  it("substring fallback is case-insensitive", () => {
    expect(fuzzyMatchToolName("SEARCH", ["web_search", "read"])).toBe("web_search");
  });
});
