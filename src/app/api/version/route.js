import https from "https";
import pkg from "../../../../package.json" with { type: "json" };
import { detectRuntime, updateAndRestartCommand } from "@/shared/utils/runtime";

const NPM_PACKAGE_NAME = "vansrouter";
// Fetch package.json from the default branch of the user's fork (dev until
// merged to main). Using 'main' here is wrong while we push releases to dev —
// it always reads the stale upstream-fork default and trips the
// githubStatus = "github_behind_npm" message in the Sidebar. The auto-update
// flow expects the live branch we actually release from.
const GITHUB_RAW_PKG = "https://raw.githubusercontent.com/Vanszs/VansRouter/dev/package.json";

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 4000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise(async (resolve) => {
    const data = await fetchJson(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`);
    resolve(data?.version || null);
  });
}

// Fetch version from GitHub main branch package.json
function fetchGitHubVersion() {
  return new Promise(async (resolve) => {
    const data = await fetchJson(GITHUB_RAW_PKG);
    resolve(data?.version || null);
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export async function GET() {
  const [latestVersion, githubVersion] = await Promise.all([
    fetchLatestVersion(),
    fetchGitHubVersion(),
  ]);
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  // Detect runtime so the Sidebar can adapt its update UI.
  const runtime = detectRuntime();
  const updateCommand = updateAndRestartCommand(runtime, NPM_PACKAGE_NAME);
  const canAutoRestart = updateCommand !== null;

  // githubStatus tells the user whether the GitHub repo already contains the
  // newer npm version or is still behind it.
  let githubStatus = null;
  if (latestVersion && githubVersion) {
    const ghVsNpm = compareVersions(githubVersion, latestVersion);
    const localVsGh = compareVersions(currentVersion, githubVersion);
    if (ghVsNpm >= 0 && localVsGh < 0) {
      githubStatus = "github_ahead"; // GitHub already has the new version
    } else if (ghVsNpm < 0) {
      githubStatus = "github_behind_npm"; // GitHub repo hasn't received the new npm version yet
    } else if (localVsGh > 0) {
      githubStatus = "local_ahead"; // local is ahead of GitHub (unpushed changes)
    } else {
      githubStatus = "current";
    }
  }

  return Response.json({
    currentVersion,
    latestVersion,
    githubVersion,
    hasUpdate,
    githubStatus,
    // Auto-update capability so the Sidebar can show the right UI:
    //   - runtime:    "pm2" | "systemd" | "screen" | "tmux" | "docker" | "direct"
    //   - canAutoRestart: true if shutting down will spawn a detached child
    //     that installs the new version AND brings the server back up
    //   - installCommand: always populated (for manual copy as a fallback)
    runtime,
    canAutoRestart,
    installCommand: updateCommand || `npm i -g ${NPM_PACKAGE_NAME}@latest`,
  });
}
