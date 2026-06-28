#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function removePropTypes(source) {
  let s = source;

  // Remove import PropTypes line
  s = s.replace(/^import PropTypes from "prop-types";\r?\n?/gm, "");

  // Remove `Name.propTypes = { ... };` blocks with brace matching.
  const out = [];
  let i = 0;
  while (i < s.length) {
    const match = s.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*\.propTypes\s*=\s*\{/m);
    if (!match) {
      out.push(s.slice(i));
      break;
    }
    const matchIndex = i + match.index;
    out.push(s.slice(i, matchIndex));

    let j = matchIndex + match[0].length - 1; // position of the opening '{'
    let depth = 1;
    j += 1;
    while (j < s.length && depth > 0) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}") depth--;
      j++;
    }
    // skip the semicolon and trailing whitespace/newlines
    while (j < s.length && /[;\s]/.test(s[j])) j++;
    // actually keep one newline if present so we don't collapse lines too much
    if (j < s.length && s[j] === "\n") j++;
    if (j < s.length && s[j] === "\r") j++;
    i = j;
  }

  return out.join("");
}

const files = process.argv.slice(2);
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const original = fs.readFileSync(file, "utf8");
  const cleaned = removePropTypes(original);
  if (cleaned !== original) {
    fs.writeFileSync(file, cleaned);
    console.log("cleaned", file);
  }
}
