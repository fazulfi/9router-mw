import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: if ALL parts are text, join into a plain string;
// otherwise return the array as-is. Matches OpenAI canonical format.
export function collapseTextParts(parts) {
  if (parts.every((p) => p.type === OPENAI_BLOCK.TEXT)) {
    return parts.map((p) => p.text).join("\n");
  }
  return parts;
}
