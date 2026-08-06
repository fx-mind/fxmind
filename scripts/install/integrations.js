/**
 * install/integrations — hooks, MCP, and FiveM RCON wiring into the target project.
 */
const fs = require("fs");
const path = require("path");

const { installHooks, isGitHookInstalled } = require("../hooks");
const { installMcp } = require("../mcp-install");
const fivemRcon = require("../fivem-rcon");

function cursorHooksPresent(targetRoot) {
  return fs.existsSync(path.join(path.resolve(targetRoot), ".cursor", "hooks.json"));
}

function cursorHookScriptsPresent(targetRoot) {
  const hooksDir = path.join(path.resolve(targetRoot), ".cursor", "hooks");
  return (
    fs.existsSync(path.join(hooksDir, "pre-commit.js")) ||
    fs.existsSync(path.join(hooksDir, "gate-guard.js"))
  );
}

function fivemInstallMarkersPresent(targetRoot) {
  const root = path.resolve(targetRoot);
  if (fs.existsSync(path.join(root, ".vscode", "fivem-start.ps1"))) {
    return true;
  }

  const tasksPath = path.join(root, ".vscode", "tasks.json");
  if (fs.existsSync(tasksPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
      if ((data.tasks || []).some((t) => t && t.label === "fivem-start")) {
        return true;
      }
    } catch {
      // ignore invalid tasks.json
    }
  }

  if (fivemRcon.isFivemInstalled(root)) {
    return true;
  }

  const fxCandidates = [
    path.join(root, "artifacts", "FXServer.exe"),
    path.join(root, "FXServer.exe"),
    path.join(root, "artifacts", "FXServer"),
    path.join(root, "FXServer"),
  ];
  return fxCandidates.some((p) => fs.existsSync(p));
}

function shouldInstallHooks(options, agents) {
  if (options.hooks === false) return false;
  if (options.hooks === true) return true;
  const cursorSelected = agents.some((agent) => agent.id === "cursor");
  const hasHooks =
    cursorHooksPresent(options.target) ||
    cursorHookScriptsPresent(options.target) ||
    isGitHookInstalled(options.target);

  // On update, refresh hooks whenever Cursor is selected or any prior hook install exists.
  if (options.update && (cursorSelected || hasHooks)) {
    return true;
  }
  return Boolean(cursorSelected && options.command);
}

function shouldInstallMcp(options, agents) {
  if (options.mcp === false) return false;
  if (options.mcp === true) return true;
  if (options.update && options.command && agents.length > 0) {
    return true;
  }
  return Boolean(agents.length > 0 && options.command);
}

function shouldRefreshFivem(options, packs = []) {
  if (options.fivem === false) return false;
  if (options.fivem === true) return true;

  const packIds = packs.length
    ? packs
    : Array.isArray(options.packs)
      ? options.packs
      : [];
  const hasFivemPack = packIds.includes("fivem");
  const markers = fivemInstallMarkersPresent(options.target);

  // Update: refresh whenever the fivem pack is installed or local RCON/task was set up before.
  if (options.update && (hasFivemPack || markers)) {
    return true;
  }

  // Fresh install: auto-wire when the fivem pack is selected.
  return Boolean(hasFivemPack && options.command);
}

function installProjectHooks(targetRoot) {
  try {
    const result = installHooks(targetRoot, { gitHook: true });
    console.log("[Hooks]");
    for (const p of result.installed) console.log(`  ✓ ${p}`);
    console.log(`  ✓ ${result.hooksJson}`);
    if (result.gitHook && typeof result.gitHook === "string") {
      console.log(`  ✓ git pre-commit → ${result.gitHook}`);
    } else if (result.gitHook && result.gitHook.error) {
      console.log(`  ⚠ git pre-commit skipped: ${result.gitHook.error}`);
    }
    console.log(
      "  Restart Cursor (or reload hooks) to activate gate-guard / drift-watcher / learn-prompt.",
    );
  } catch (error) {
    console.log(`[Hooks] skipped: ${error.message}`);
  }
}

function installProjectMcp(targetRoot, agents) {
  try {
    const agentIds = agents.map((agent) => agent.id);
    const result = installMcp(targetRoot, { agentIds });
    console.log("[MCP]");
    for (const item of result.installed) {
      console.log(`  ✓ ${item.label}: ${item.configRel} → server "${item.server}"`);
    }
    for (const configRel of result.pruned || []) {
      console.log(`  ✓ removed stale MCP: ${configRel}`);
    }
    if (result.entry) {
      console.log(`  command: ${result.entry.command}`);
      if (result.entry.args?.length) {
        console.log(`  args: ${result.entry.args.join(" ")}`);
      }
      if (result.entry.cwd) {
        console.log(`  cwd: ${result.entry.cwd}`);
      }
      console.log(`  FXMIND_TARGET: ${result.entry.env.FXMIND_TARGET}`);
    }
    console.log("  Restart your agent client (MCP settings) to connect fxmind tools.");
  } catch (error) {
    console.log(`[MCP] skipped: ${error.message}`);
  }
}

function installProjectFivem(targetRoot) {
  try {
    const result = fivemRcon.installFivemDev({ root: path.resolve(targetRoot) });
    console.log("[FiveM]");
    for (const step of result.steps || []) {
      const detail = [step.path, step.action].filter(Boolean).join(" ");
      console.log(`  ✓ ${step.step}: ${detail}`);
    }
    for (const warning of result.warnings || []) {
      console.log(`  ⚠ ${warning}`);
    }
    if (result.note) {
      console.log(`  ${result.note}`);
    }
  } catch (error) {
    console.log(`[FiveM] skipped: ${error.message}`);
  }
}

function installProjectCursorIntegration(targetRoot, options, agents, packs = []) {
  if (shouldInstallHooks(options, agents)) {
    installProjectHooks(targetRoot);
  }
  if (shouldInstallMcp(options, agents)) {
    installProjectMcp(targetRoot, agents);
  }
  if (shouldRefreshFivem(options, packs)) {
    installProjectFivem(targetRoot);
  }
}

module.exports = {
  cursorHooksPresent,
  cursorHookScriptsPresent,
  fivemInstallMarkersPresent,
  shouldInstallHooks,
  shouldInstallMcp,
  shouldRefreshFivem,
  installProjectHooks,
  installProjectMcp,
  installProjectFivem,
  installProjectCursorIntegration,
};
