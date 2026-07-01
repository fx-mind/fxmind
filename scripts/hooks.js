/**
 * fxmind hooks — install and manage Cursor project hooks for fxmind.
 *
 * Hooks live under .cursor/hooks/ and .cursor/hooks.json. They are opt-in and
 * are installed for the Cursor agent by default when `--hooks` is passed or
 * during a normal install (Cursor only).
 *
 * Also exposes CLI wrappers around fxmind-tools so users can run drift checks,
 * graph rebuilds, and gate inspection from the terminal:
 *   fxmind hooks install [--target <dir>]
 *   fxmind hooks uninstall [--target <dir>]
 *   fxmind hooks status [--target <dir>]
 *   fxmind hooks drift-check <file> [--target <dir>]
 *   fxmind hooks graph [--target <dir>] [--no-open]
 *   fxmind hooks gates [--target <dir>]
 */

const fs = require("fs");
const path = require("path");

const { SHARED_DIR } = require("./global-store");
const tools = require("./fxmind-tools");
const { buildGraphData, writeGraph, openGraphInBrowser } = require("./build-graph");
const { driftForStagedFiles } = require("./lib/memory-drift");

const HOOKS_DIR_REL = path.join(".cursor", "hooks");
const HOOKS_JSON_REL = path.join(".cursor", "hooks.json");
const GIT_HOOK_MARKER = "# --- fxmind pre-commit ---";

const HOOK_SCRIPTS = [
  "gate-guard.js",
  "drift-watcher.js",
  "learn-prompt.js",
  "pre-commit.js",
];

const HOOK_LIB_FILES = ["memory-drift.js"];

const FXMIND_COMMANDS = {
  preToolUse: "node .cursor/hooks/gate-guard.js",
  postToolUse: "node .cursor/hooks/drift-watcher.js",
  stop: "node .cursor/hooks/learn-prompt.js",
};

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function templateHooksDir() {
  return path.join(__dirname, "..", "templates", "hooks");
}

function hookLibDir() {
  return path.join(__dirname, "lib");
}

function copyHookBundle(projectRoot) {
  const projectRootResolved = path.resolve(projectRoot);
  const hooksDir = path.join(projectRootResolved, HOOKS_DIR_REL);
  fs.mkdirSync(hooksDir, { recursive: true });

  const srcDir = templateHooksDir();
  const installed = [];

  for (const name of HOOK_SCRIPTS) {
    const src = path.join(srcDir, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(hooksDir, name);
    fs.copyFileSync(src, dest);
    installed.push(path.relative(projectRootResolved, dest).replace(/\\/g, "/"));
  }

  const libDestDir = path.join(hooksDir, "lib");
  fs.mkdirSync(libDestDir, { recursive: true });
  for (const name of HOOK_LIB_FILES) {
    const src = path.join(hookLibDir(), name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(libDestDir, name);
    fs.copyFileSync(src, dest);
    installed.push(path.relative(projectRootResolved, dest).replace(/\\/g, "/"));
  }

  return { hooksDir, installed };
}

function gitPreCommitBody() {
  return `${GIT_HOOK_MARKER}
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0
if [ -f .cursor/hooks/pre-commit.js ]; then
  node .cursor/hooks/pre-commit.js
  exit $?
fi
exit 0
`;
}

function installGitHook(targetRoot) {
  const projectRoot = path.resolve(targetRoot);
  const gitHooksDir = path.join(projectRoot, ".git", "hooks");
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    throw new Error("Not a git repository — run from project root with .git/");
  }

  fs.mkdirSync(gitHooksDir, { recursive: true });
  const hookPath = path.join(gitHooksDir, "pre-commit");
  const fxmindBlock = `#!/bin/sh\n${gitPreCommitBody()}`;

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf8");
    if (existing.includes(GIT_HOOK_MARKER)) {
      const without = existing.replace(
        new RegExp(`#!/bin/sh\\s*\\n${GIT_HOOK_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=\\n# --- |$)`),
        "",
      );
      fs.writeFileSync(hookPath, `${fxmindBlock}\n${without.trim()}\n`, "utf8");
    } else {
      fs.writeFileSync(hookPath, `${fxmindBlock}\n${existing}`, "utf8");
    }
  } else {
    fs.writeFileSync(hookPath, `${fxmindBlock}\n`, "utf8");
  }

  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // Windows may ignore chmod
  }

  return path.relative(projectRoot, hookPath).replace(/\\/g, "/");
}

function uninstallGitHook(targetRoot) {
  const projectRoot = path.resolve(targetRoot);
  const hookPath = path.join(projectRoot, ".git", "hooks", "pre-commit");
  if (!fs.existsSync(hookPath)) {
    return null;
  }

  const existing = fs.readFileSync(hookPath, "utf8");
  if (!existing.includes(GIT_HOOK_MARKER)) {
    return null;
  }

  const cleaned = existing
    .replace(
      new RegExp(`#!/bin/sh\\s*\\n${GIT_HOOK_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=\\n# --- |$)`),
      "",
    )
    .trim();

  if (!cleaned || cleaned === "#!/bin/sh") {
    fs.unlinkSync(hookPath);
  } else {
    fs.writeFileSync(hookPath, `${cleaned}\n`, "utf8");
  }

  return path.relative(projectRoot, hookPath).replace(/\\/g, "/");
}

function runPreCommitCheck(targetRoot, options = {}) {
  const projectRoot = path.resolve(targetRoot);
  const fxmindDir = path.join(projectRoot, SHARED_DIR);
  if (!fs.existsSync(fxmindDir)) {
    return { skipped: true, reason: "no .fxmind/" };
  }

  const { execFileSync } = require("child_process");
  let staged = [];
  try {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"],
      { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();
    staged = out ? out.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return { skipped: true, reason: "not a git repo or git unavailable" };
  }

  if (staged.length === 0) {
    return { skipped: true, reason: "nothing staged" };
  }

  const blockStale =
    options.blockStale || process.env.FXMIND_PRECOMMIT_STRICT === "1";
  return {
    skipped: false,
    staged,
    ...driftForStagedFiles(projectRoot, staged, { blockStale }),
  };
}

function installHooks(targetRoot, options = {}) {
  const projectRoot = path.resolve(targetRoot);
  const { installed } = copyHookBundle(projectRoot);

  const hooksJsonPath = path.join(projectRoot, HOOKS_JSON_REL);
  const existing = readJson(hooksJsonPath, { version: 1, hooks: {} });
  existing.version = existing.version || 1;
  existing.hooks = existing.hooks || {};

  for (const [event, command] of Object.entries(FXMIND_COMMANDS)) {
    if (!Array.isArray(existing.hooks[event])) {
      existing.hooks[event] = [];
    }
    existing.hooks[event] = existing.hooks[event].filter(
      (entry) => typeof entry === "object" && entry.command !== command,
    );
    existing.hooks[event].push({ command, timeout: 15 });
  }

  writeJson(hooksJsonPath, existing);

  let gitHook = null;
  if (options.gitHook !== false && fs.existsSync(path.join(projectRoot, ".git"))) {
    try {
      gitHook = installGitHook(projectRoot);
    } catch (error) {
      gitHook = { error: error.message };
    }
  }

  return {
    installed,
    hooksJson: HOOKS_JSON_REL.replace(/\\/g, "/"),
    gitHook,
  };
}

function uninstallHooks(targetRoot) {
  const projectRoot = path.resolve(targetRoot);
  const removed = [];

  for (const name of HOOK_SCRIPTS) {
    const file = path.join(projectRoot, HOOKS_DIR_REL, name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      removed.push(path.relative(projectRoot, file).replace(/\\/g, "/"));
    }
  }

  for (const name of HOOK_LIB_FILES) {
    const file = path.join(projectRoot, HOOKS_DIR_REL, "lib", name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      removed.push(path.relative(projectRoot, file).replace(/\\/g, "/"));
    }
  }

  const hooksJsonPath = path.join(projectRoot, HOOKS_JSON_REL);
  const existing = readJson(hooksJsonPath);
  if (existing && existing.hooks) {
    for (const event of Object.keys(FXMIND_COMMANDS)) {
      if (!Array.isArray(existing.hooks[event])) continue;
      existing.hooks[event] = existing.hooks[event].filter(
        (entry) => typeof entry === "object" && entry.command !== FXMIND_COMMANDS[event],
      );
      if (existing.hooks[event].length === 0) delete existing.hooks[event];
    }
    if (Object.keys(existing.hooks).length === 0) {
      delete existing.hooks;
    }
    if (fs.existsSync(hooksJsonPath)) {
      writeJson(hooksJsonPath, existing);
      removed.push(HOOKS_JSON_REL.replace(/\\/g, "/"));
    }
  }

  return { removed };
}

function hooksStatus(targetRoot) {
  const projectRoot = path.resolve(targetRoot);
  const hooksJsonPath = path.join(projectRoot, HOOKS_JSON_REL);
  const existing = readJson(hooksJsonPath);
  const present = {};
  for (const name of HOOK_SCRIPTS) {
    present[name] = fs.existsSync(path.join(projectRoot, HOOKS_DIR_REL, name));
  }
  const wired = {};
  for (const [event, command] of Object.entries(FXMIND_COMMANDS)) {
    wired[event] = Boolean(
      existing &&
        Array.isArray(existing.hooks?.[event]) &&
        existing.hooks[event].some((e) => e?.command === command),
    );
  }
  return { present, wired, hooksJsonExists: fs.existsSync(hooksJsonPath) };
}

function isGitHookInstalled(targetRoot) {
  const hookPath = path.join(path.resolve(targetRoot), ".git", "hooks", "pre-commit");
  if (!fs.existsSync(hookPath)) return false;
  return fs.readFileSync(hookPath, "utf8").includes(GIT_HOOK_MARKER);
}

function printHooksHelp() {
  console.log(`fxmind hooks — manage Cursor hooks + run fxmind tooling from the terminal.

Usage:
  fxmind hooks install [--target <dir>] [--no-git-hook]   Install Cursor hooks + optional git pre-commit
  fxmind hooks install-git [--target <dir>]               Install git pre-commit only (.git/hooks/pre-commit)
  fxmind hooks uninstall [--target <dir>]                 Remove Cursor hook scripts and entries
  fxmind hooks uninstall-git [--target <dir>]             Remove fxmind block from git pre-commit
  fxmind hooks status [--target <dir>]                    Show what is installed
  fxmind hooks pre-commit [--strict]                      Run pre-commit drift check on staged files
  fxmind hooks drift-check <file>                         Check memories referencing <file>
  fxmind hooks graph [--no-open]                          Rebuild knowledge graph
  fxmind hooks gates                                      Show Gate A/B/C status from .fxmind-gates.json
  fxmind hooks -h                                         This help

Cursor hooks:
  preToolUse  → .cursor/hooks/gate-guard.js     (enforce Gates A/B before code edits)
  postToolUse → .cursor/hooks/drift-watcher.js  (memory drift + graph-pending flag)
  stop        → .cursor/hooks/learn-prompt.js   (remind to finish Gate C)

Git pre-commit:
  Blocks commit when staged code files break topic memories (paths[] → missing file).
  Warnings only for stale-candidate; use --strict or FXMIND_PRECOMMIT_STRICT=1 to block those too.`);
}

function parseHookCliArgs(argv) {
  const options = {
    target: process.cwd(),
    open: true,
    help: false,
    file: null,
    gitHook: true,
    blockStale: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--target") {
      options.target = path.resolve(argv[++i] || "");
    } else if (arg === "--no-open") options.open = false;
    else if (arg === "--no-git-hook") options.gitHook = false;
    else if (arg === "--strict") options.blockStale = true;
    else if (!arg.startsWith("-")) {
      options.file = options.file || arg;
    }
  }
  return options;
}

function runHooksCli(argv = []) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === "-h" || sub === "--help" || !sub) {
    printHooksHelp();
    return sub ? 1 : 0;
  }

  if (sub === "install") {
    const options = parseHookCliArgs(rest);
    const result = installHooks(options.target, { gitHook: options.gitHook });
    console.log(`Installed fxmind hooks → ${options.target}`);
    for (const p of result.installed) console.log(`  ✓ ${p}`);
    console.log(`  ✓ ${result.hooksJson}`);
    if (result.gitHook && typeof result.gitHook === "string") {
      console.log(`  ✓ git pre-commit → ${result.gitHook}`);
    } else if (result.gitHook && result.gitHook.error) {
      console.log(`  ⚠ git pre-commit skipped: ${result.gitHook.error}`);
    }
    console.log("Restart Cursor (or reload hooks) for changes to take effect.");
    return 0;
  }

  if (sub === "install-git") {
    const options = parseHookCliArgs(rest);
    try {
      copyHookBundle(options.target);
      const hook = installGitHook(options.target);
      console.log(`Installed git pre-commit → ${options.target}`);
      console.log(`  ✓ ${hook}`);
      return 0;
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return 1;
    }
  }

  if (sub === "uninstall") {
    const options = parseHookCliArgs(rest);
    const result = uninstallHooks(options.target);
    console.log(`Uninstalled fxmind hooks → ${options.target}`);
    for (const p of result.removed) console.log(`  ✓ removed ${p}`);
    return 0;
  }

  if (sub === "uninstall-git") {
    const options = parseHookCliArgs(rest);
    const removed = uninstallGitHook(options.target);
    if (removed) {
      console.log(`Removed fxmind block from ${removed}`);
    } else {
      console.log("No fxmind pre-commit block found.");
    }
    return 0;
  }

  if (sub === "status") {
    const options = parseHookCliArgs(rest);
    const status = hooksStatus(options.target);
    console.log(`fxmind hooks status → ${options.target}`);
    console.log(`  hooks.json: ${status.hooksJsonExists ? "present" : "missing"}`);
    for (const [name, present] of Object.entries(status.present)) {
      console.log(`  script ${name}: ${present ? "present" : "missing"}`);
    }
    for (const [event, wired] of Object.entries(status.wired)) {
      console.log(`  event  ${event}: ${wired ? "wired" : "not wired"}`);
    }
    console.log(
      `  git pre-commit: ${isGitHookInstalled(options.target) ? "installed" : "not installed"}`,
    );
    return 0;
  }

  if (sub === "pre-commit") {
    const options = parseHookCliArgs(rest);
    const result = runPreCommitCheck(options.target, { blockStale: options.blockStale });
    if (result.skipped) {
      console.log(`pre-commit skipped: ${result.reason}`);
      return 0;
    }
    console.log(JSON.stringify(result, null, 2));
    return result.block ? 1 : 0;
  }

  if (sub === "drift-check") {
    const options = parseHookCliArgs(rest);
    if (!options.file) {
      console.error("Error: drift-check requires a file path.");
      return 1;
    }
    const result = tools.driftCheck(options.target, options.file);
    console.log(JSON.stringify(result, null, 2));
    return result.hits.length > 0 ? 0 : 0;
  }

  if (sub === "graph") {
    const options = parseHookCliArgs(rest);
    try {
      const data = buildGraphData(options.target);
      const paths = writeGraph(options.target, data);
      console.log(`Graph built: learned=${data.meta.counts.learned} links=${data.meta.counts.links}`);
      console.log(`  json → ${paths.jsonPath}`);
      console.log(`  html → ${paths.htmlPath}`);
      if (options.open) openGraphInBrowser(paths.absoluteHtmlPath);
      return 0;
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return 1;
    }
  }

  if (sub === "gates") {
    const options = parseHookCliArgs(rest);
    const status = tools.gateStatus(options.target);
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }

  printHooksHelp();
  return 1;
}

module.exports = {
  HOOKS_DIR_REL,
  HOOKS_JSON_REL,
  HOOK_SCRIPTS,
  HOOK_LIB_FILES,
  FXMIND_COMMANDS,
  GIT_HOOK_MARKER,
  installHooks,
  uninstallHooks,
  installGitHook,
  uninstallGitHook,
  isGitHookInstalled,
  runPreCommitCheck,
  hooksStatus,
  runHooksCli,
  copyHookBundle,
};
