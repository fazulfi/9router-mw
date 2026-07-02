import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);
const { fixStandaloneSymlinks } = require("../../scripts/fix-standalone-symlinks.cjs");

/**
 * Creates a directory symbolic link in a Windows-safe way.
 * On Windows, directory symlinks require the SeCreateSymbolicLinkPrivilege,
 * whereas junctions work without elevation. On non-Windows platforms a normal
 * directory symlink is used.
 */
function createDirLink(target, link) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

describe("fixStandaloneSymlinks", () => {
  let tmpDir;
  let originalPlatform;
  let originalDryRun;
  const logs = [];
  const errors = [];
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fix-symlinks-"));
    originalPlatform = process.platform;
    originalDryRun = process.env.FIX_SYMLINKS_DRY_RUN;
    logs.length = 0;
    errors.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation((msg) => logs.push(msg));
    errorSpy = vi.spyOn(console, "error").mockImplementation((msg) => errors.push(msg));
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    if (originalDryRun === undefined) {
      delete process.env.FIX_SYMLINKS_DRY_RUN;
    } else {
      process.env.FIX_SYMLINKS_DRY_RUN = originalDryRun;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports a function", () => {
    expect(typeof fixStandaloneSymlinks).toBe("function");
  });

  it("is a no-op on non-Windows platforms", () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    const target = path.join(tmpDir, "target");
    const link = path.join(tmpDir, "link");
    fs.mkdirSync(target);
    createDirLink(target, link);

    fixStandaloneSymlinks(tmpDir);

    expect(logs).toContain("Skipping: not Windows");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(target);
  });

  it("converts absolute directory symlinks to junctions on Windows", () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    const target = path.join(tmpDir, "target");
    const link = path.join(tmpDir, "link");
    fs.mkdirSync(target);
    createDirLink(target, link);

    fixStandaloneSymlinks(tmpDir);

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(path.isAbsolute(fs.readlinkSync(link))).toBe(true);
    expect(logs.some((line) =>
      line.includes("SYMLINK → JUNCTION") && line.includes(link)
    )).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("skips file symlinks", function() {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    const file = path.join(tmpDir, "file");
    const link = path.join(tmpDir, "filelink");
    fs.writeFileSync(file, "hello");
    try {
      fs.symlinkSync(file, link, "file");
    } catch (err) {
      // Windows file symlinks require the SeCreateSymbolicLinkPrivilege.
      // If the test environment lacks it, skip this case rather than failing.
      if (err && (err.code === "EPERM" || err.code === "ENOENT")) {
        return this.skip();
      }
      throw err;
    }

    fixStandaloneSymlinks(tmpDir);

    expect(fs.readlinkSync(link)).toBe(file);
    expect(logs.some((line) => line.includes(link))).toBe(false);
  });

  it("converts relative directory symlinks to absolute junctions", () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    const target = path.join(tmpDir, "target");
    const link = path.join(tmpDir, "link");
    fs.mkdirSync(target);
    createDirLink("target", link);

    fixStandaloneSymlinks(tmpDir);

    // Junctions store an absolute target path.
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(path.isAbsolute(fs.readlinkSync(link))).toBe(true);
    expect(fs.readlinkSync(link)).toBe(target);
    expect(logs.some((line) =>
      line.includes("SYMLINK → JUNCTION") && line.includes(link)
    )).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("logs but does not modify in dry-run mode", () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.FIX_SYMLINKS_DRY_RUN = "1";
    const target = path.join(tmpDir, "target");
    const link = path.join(tmpDir, "link");
    fs.mkdirSync(target);
    createDirLink(target, link);

    fixStandaloneSymlinks(tmpDir);

    expect(fs.readlinkSync(link)).toBe(target);
    expect(logs.some((line) =>
      line.startsWith("DRY RUN") && line.includes(link)
    )).toBe(true);
  });
});
