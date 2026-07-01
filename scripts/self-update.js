/**
 * Self-update global fxmind before `fxmind --update` refreshes a project.
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const { GITHUB_PKG } = require("./constants");
const { PACKAGE_ROOT } = require("./resolve-packs");

function isLocalDevelopmentInstall(packageRoot = PACKAGE_ROOT) {
  const root = path.resolve(packageRoot).replace(/\\/g, "/");
  return !root.includes("/node_modules/fxmind");
}

function resolveGlobalInstallScript() {
  try {
    const npmRoot = execSync("npm root -g", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const script = path.join(npmRoot, "fxmind", "scripts", "install.js");
    if (fs.existsSync(script)) {
      return script;
    }
  } catch {
    // fall through
  }
  return path.join(PACKAGE_ROOT, "scripts", "install.js");
}

function updateGlobalInstall() {
  execSync(`npm install -g ${GITHUB_PKG}`, {
    stdio: "inherit",
    shell: true,
  });
}

function maybeSelfUpdateAndReexec(argv, options = {}) {
  if (!argv.includes("--update")) {
    return false;
  }
  if (options.noSelfUpdate) {
    return false;
  }
  if (process.env.FXMIND_NO_SELF_UPDATE === "1") {
    return false;
  }
  if (isLocalDevelopmentInstall()) {
    console.log(
      "[Self-update] skipped (local install — run npm install -g . or npm link to refresh global)",
    );
    return false;
  }

  console.log("\n[Self-update] Updating global fxmind from GitHub...");
  try {
    updateGlobalInstall();
  } catch (error) {
    console.log(`[Self-update] skipped: ${error.message}`);
    return false;
  }

  const entry = resolveGlobalInstallScript();
  console.log("[Self-update] Restarting with updated fxmind...\n");
  const child = spawnSync(process.execPath, [entry, ...argv], {
    stdio: "inherit",
    env: { ...process.env, FXMIND_NO_SELF_UPDATE: "1" },
    cwd: process.cwd(),
  });
  process.exit(child.status ?? 1);
  return true;
}

module.exports = {
  GITHUB_PKG,
  isLocalDevelopmentInstall,
  resolveGlobalInstallScript,
  updateGlobalInstall,
  maybeSelfUpdateAndReexec,
};
