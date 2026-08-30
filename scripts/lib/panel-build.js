/**
 * Build the panel source into the distributable fxmind/web/dist directory.
 *
 * The panel source intentionally lives beside the fxmind package in the
 * workspace (../panel). Published packages can already contain web/dist, so
 * a missing source tree is fine as long as that build exists.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const WEB_DIST = path.join(PACKAGE_ROOT, "web", "dist");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function quoteCmdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function isPanelSourceRoot(root) {
  return Boolean(
    root &&
      fs.existsSync(path.join(root, "package.json")) &&
      fs.existsSync(path.join(root, "index.html")) &&
      fs.existsSync(path.join(root, "src")),
  );
}

function candidatePanelRoots() {
  return [
    process.env.FXMIND_PANEL_ROOT,
    path.join(PACKAGE_ROOT, "..", "panel"),
    path.join(process.cwd(), "panel"),
  ].filter(Boolean);
}

function findPanelRoot() {
  for (const candidate of candidatePanelRoots()) {
    const root = path.resolve(candidate);
    if (isPanelSourceRoot(root)) return root;
  }
  return null;
}

function hasPanelBuild() {
  return fs.existsSync(path.join(WEB_DIST, "index.html"));
}

function runNpm(args, cwd, quiet = false) {
  const env = { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  for (const key of Object.keys(env)) {
    if (/^npm_config_(prefix|local_prefix|global)$/i.test(key)) {
      delete env[key];
    }
  }

  const options = {
    cwd,
    env,
    stdio: quiet ? "pipe" : "inherit",
    windowsHide: true,
  };

  if (process.platform === "win32") {
    const command = [npmCommand(), ...args].map(quoteCmdArg).join(" ");
    return execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], options);
  }

  return execFileSync(npmCommand(), args, options);
}

/**
 * Build the panel.
 *
 * When the package is installed from npm/GitHub, the source tree is not
 * bundled and the prebuilt web/dist is used. In the workspace, installation
 * and update call this with installDependencies=true so a fresh checkout is
 * immediately runnable.
 */
function buildPanel(options = {}) {
  const {
    installDependencies = true,
    strict = true,
    quiet = false,
  } = options;
  const panelRoot = findPanelRoot();

  if (!panelRoot) {
    if (hasPanelBuild()) {
      return {
        ok: true,
        built: false,
        skipped: true,
        reason: "panel source not bundled; using existing web/dist",
        panelRoot: null,
        dist: WEB_DIST,
      };
    }

    const message =
      "Panel source not found and web/dist is missing. " +
      "Set FXMIND_PANEL_ROOT or build the panel from the FXMIND workspace.";
    if (strict) throw new Error(message);
    return { ok: false, built: false, skipped: true, error: message, dist: WEB_DIST };
  }

  try {
    if (installDependencies) {
      runNpm(
        ["install", "--no-audit", "--no-fund"],
        panelRoot,
        quiet,
      );
    }
    runNpm(["run", "build"], panelRoot, quiet);

    if (!hasPanelBuild()) {
      throw new Error(`Panel build completed without ${path.join(WEB_DIST, "index.html")}`);
    }

    return {
      ok: true,
      built: true,
      skipped: false,
      panelRoot,
      dist: WEB_DIST,
    };
  } catch (error) {
    const message = `Panel build failed: ${error.message || error}`;
    if (strict) throw new Error(message);
    return { ok: false, built: false, skipped: false, error: message, panelRoot, dist: WEB_DIST };
  }
}

function printBuildResult(result, reason = "manual") {
  if (result.skipped) {
    console.log(`[Panel] ${result.reason}.`);
    return;
  }
  if (result.built) {
    console.log(`[Panel] build generated during ${reason}.`);
  }
}

function runBuildCli(argv = []) {
  const installDependencies = !argv.includes("--no-install");
  const optional = argv.includes("--if-present");
  const strict = !optional;
  const quiet = argv.includes("--quiet");

  try {
    const result = buildPanel({ installDependencies, strict, quiet });
    if (!result.ok && optional && result.skipped) {
      console.warn(`[Panel] ${result.error} Skipping optional build.`);
      return 0;
    }
    printBuildResult(result, "build");
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`[Panel] ${error.message || error}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = runBuildCli(process.argv.slice(2));
}

module.exports = {
  PACKAGE_ROOT,
  WEB_DIST,
  candidatePanelRoots,
  findPanelRoot,
  hasPanelBuild,
  buildPanel,
  printBuildResult,
  runBuildCli,
};
