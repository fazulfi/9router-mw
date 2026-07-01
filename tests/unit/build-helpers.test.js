import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);
const { ensureModuleInBundle, copyRecursive } = require("../../cli/scripts/build-cli.js");

/**
 * Creates a directory symbolic link in a Windows-safe way.
 * On Windows, directory symlinks require the SeCreateSymbolicLinkPrivilege,
 * whereas junctions work without elevation. On non-Windows platforms a normal
 * directory symlink is used.
 */
function createDirLink(target, link) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

describe("build-helpers", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "build-helpers-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("declares @swc/helpers in root package.json dependencies", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(rootPkg.dependencies).toHaveProperty("@swc/helpers");
  });

  it("resolves @swc/helpers/package.json from the project root", () => {
    const resolved = require.resolve("@swc/helpers/package.json", { paths: [process.cwd()] });
    expect(resolved).toMatch(/@swc[\\/]helpers[\\/]package\.json$/);
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it("calls ensureModuleInBundle for @swc/helpers in build-cli.js", () => {
    const buildCliPath = path.resolve("cli/scripts/build-cli.js");
    const content = fs.readFileSync(buildCliPath, "utf8");
    expect(content).toMatch(/ensureModuleInBundle\s*\(\s*["']@swc\/helpers["']\s*,/);
  });

  it("copies a package into the bundle node_modules from the candidate path", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const pkgDir = path.join(appDir, "node_modules", "@swc", "helpers");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};");

    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });

    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    expect(fs.existsSync(path.join(destDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "index.js"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(destDir, "package.json"), "utf8")).name).toBe("@swc/helpers");
  });

  it("copies a package from a pnpm-like virtual-store layout into the bundle node_modules", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const virtualStoreDir = path.join(
      appDir,
      "node_modules",
      ".pnpm",
      "@swc+helpers@0.5.0",
      "node_modules",
      "@swc",
      "helpers"
    );
    fs.mkdirSync(virtualStoreDir, { recursive: true });
    fs.writeFileSync(
      path.join(virtualStoreDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );
    fs.writeFileSync(path.join(virtualStoreDir, "index.js"), "module.exports = {};");

    // pnpm creates a symlink at app/node_modules/@swc/helpers pointing into the virtual store.
    const pkgLinkDir = path.join(appDir, "node_modules", "@swc");
    fs.mkdirSync(pkgLinkDir, { recursive: true });
    createDirLink(
      path.relative(pkgLinkDir, virtualStoreDir),
      path.join(pkgLinkDir, "helpers")
    );

    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });

    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    expect(fs.existsSync(path.join(destDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "index.js"))).toBe(true);
    expect(fs.lstatSync(destDir).isSymbolicLink()).toBe(false);
  });

  it("falls back to require.resolve when the package is not in the direct candidate paths", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = appDir;
    const cliAppDir = path.join(tmpDir, "cli", "app");
    // Package lives in an ancestor node_modules directory so direct candidates miss but
    // Node's module resolver walks up and finds it.
    const pkgDir = path.join(tmpDir, "node_modules", "@swc", "helpers");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};");

    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });

    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    expect(fs.existsSync(path.join(destDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "index.js"))).toBe(true);
  });

  it("is a no-op when the package is already present in the bundle", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(
      path.join(destDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });
    spy.mockRestore();

    expect(fs.readdirSync(destDir)).toEqual(["package.json"]);
  });

  it("warns when the package cannot be resolved", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const missingPkg = "@swc/helpers-does-not-exist-xyz123";

    const originalWarn = console.warn;
    const warnSpy = vi.fn();
    console.warn = warnSpy;
    ensureModuleInBundle(missingPkg, { cliAppDir, appDir, rootDir, copyRecursive });
    console.warn = originalWarn;

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`${missingPkg} not found locally`));
  });
});
