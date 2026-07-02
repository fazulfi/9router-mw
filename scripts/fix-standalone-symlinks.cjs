const fs = require("fs");
const path = require("path");

/**
 * Fix Windows EPERM errors caused by .pnpm directory symlinks in the Next.js
 * standalone output. Directory symlinks that point to absolute targets are
 * converted to junctions, which do not require the SeCreateSymbolicLinkPrivilege.
 */
function fixStandaloneSymlinks(
  standaloneDir = path.resolve(__dirname, "..", ".next", "standalone")
) {
  if (process.platform !== "win32") {
    console.log("Skipping: not Windows");
    return;
  }

  const dryRun = Boolean(process.env.FIX_SYMLINKS_DRY_RUN);
  const linkPaths = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        linkPaths.push(fullPath);
      } else if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }

  walk(standaloneDir);

  for (const linkPath of linkPaths) {
    let target;
    try {
      target = fs.readlinkSync(linkPath);
    } catch {
      continue;
    }

    // Resolve to an absolute path. Junctions require absolute targets, so a
    // relative symlink (the pnpm/.pnpm layout uses these, e.g.
    // "../../react@19.2.4/node_modules/react") MUST be resolved against its
    // parent dir before being recreated as a junction. Skipping relative
    // symlinks would leave every .pnpm link untouched and EPERM would persist.
    const absoluteTarget = path.resolve(path.dirname(linkPath), target);

    try {
      if (!fs.statSync(absoluteTarget).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    if (dryRun) {
      console.log(`DRY RUN — SYMLINK → JUNCTION: ${linkPath} -> ${absoluteTarget}`);
      continue;
    }

    try {
      fs.unlinkSync(linkPath);
      fs.symlinkSync(absoluteTarget, linkPath, "junction");
      console.log(`SYMLINK → JUNCTION: ${linkPath} -> ${absoluteTarget}`);
    } catch (err) {
      console.error(`Failed to convert ${linkPath}: ${err.message}`);
    }
  }
}

if (require.main === module) {
  fixStandaloneSymlinks();
}

module.exports = { fixStandaloneSymlinks };
