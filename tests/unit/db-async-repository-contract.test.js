import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dbRoot = new URL("../../src/lib/db/", import.meta.url);
const scanRoots = ["repos", "helpers"];
const extraFiles = ["index.js"];

function collectJs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectJs(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

function sourceFiles() {
  const root = dbRoot.pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
  return [
    ...scanRoots.flatMap((name) => collectJs(join(root, name))).filter((file) => !file.endsWith("metaStore.js")),
    ...extraFiles.map((name) => join(root, name)),
  ];
}

describe("async database repository contract", () => {
  it("awaits adapter queries and transactions in async repositories", () => {
    const offenders = [];
    const callPattern = /(?<!await\s)(?<!return\s)(?:\bdb|\badapter)\.(run|get|all|exec|transaction)\s*\(/g;
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(callPattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line}:${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps runtime import queries portable across SQLite and PostgreSQL", () => {
    const source = readFileSync(new URL("../../src/lib/db/index.js", import.meta.url), "utf8");
    expect(source).not.toContain("INSERT OR REPLACE");
    expect(source.match(/ON CONFLICT/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it("reports database health without issuing PostgreSQL-incompatible pragmas", () => {
    const source = readFileSync(new URL("../../src/app/api/health/route.js", import.meta.url), "utf8");
    expect(source).toContain("hotpath.database");
    expect(source).toContain('adapter?.driver !== "postgresql"');
    expect(source).toContain("await adapter.get");
  });
});
