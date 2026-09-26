/**
 * Self-update global fxmind before `fxmind --update` refreshes a project.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const { GITHUB_PKG } = require("./constants");
const { PACKAGE_ROOT } = require("./resolve-packs");

function isLocalDevelopmentInstall(packageRoot = PACKAGE_ROOT) {
  const root = path.resolve(packageRoot).replace(/\\/g, "/");
  return !root.includes("/node_modules/fxmind");
}

/**
 * Fallback prefix used when the default npm global dir cannot be written
 * (e.g. the npm global fxmind folder is a dead junction that even
 * `npm install -g` cannot replace).
 */
function fallbackPrefix() {
  return path.join(os.homedir(), ".fxmind", "npm");
}

function fallbackInstallScript() {
  const root = process.platform === "win32"
    ? path.join(fallbackPrefix(), "node_modules")
    : path.join(fallbackPrefix(), "lib", "node_modules");
  return path.join(root, "fxmind", "scripts", "install.js");
}

/** True when `dir` can be listed (a dead junction throws UNKNOWN here). */
function isReadableDir(dir) {
  try {
    fs.readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

function resolveGlobalInstallScript() {
  try {
    const npmRoot = execSync("npm root -g", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const dir = path.join(npmRoot, "fxmind");
    const script = path.join(dir, "scripts", "install.js");
    if (isReadableDir(dir) && fs.existsSync(script)) {
      return script;
    }
  } catch {
    // fall through
  }
  const fallback = fallbackInstallScript();
  if (fs.existsSync(fallback)) return fallback;
  return path.join(PACKAGE_ROOT, "scripts", "install.js");
}

function updateGlobalInstall() {
  try {
    execSync(`npm install -g ${GITHUB_PKG}`, {
      stdio: "inherit",
      shell: true,
    });
    return { prefix: null };
  } catch (error) {
    const reason = String(error.message).trim().slice(0, 160);
    console.log(`[Self-update] default global install failed (${reason}).`);
    console.log(`[Self-update] retrying into ${fallbackPrefix()} ...`);
    execSync(`npm install -g --prefix "${fallbackPrefix()}" ${GITHUB_PKG}`, {
      stdio: "inherit",
      shell: true,
    });
    return { prefix: fallbackPrefix() };
  }
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
  if (path.resolve(entry).startsWith(path.resolve(fallbackPrefix()))) {
    console.log(
      `[Self-update] the default npm global dir is unusable — fxmind now runs from ${fallbackPrefix()}. ` +
        "Remove the broken npm global fxmind folder to go back to the default.",
    );
  }
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
  isReadableDir,
  fallbackPrefix,
  fallbackInstallScript,
  resolveGlobalInstallScript,
  updateGlobalInstall,
  maybeSelfUpdateAndReexec,
};
