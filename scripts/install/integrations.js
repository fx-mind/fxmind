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
    if (!result.changed) {
      return { changed: false };
    }
    console.log("[Hooks]");
    for (const p of result.installed) console.log(`  ✓ ${p}`);
    if (result.hooksJsonChanged) {
      console.log(`  ✓ ${result.hooksJson}`);
    }
    if (result.gitHook && typeof result.gitHook === "string") {
      console.log(`  ✓ git pre-commit → ${result.gitHook}`);
    } else if (result.gitHook && result.gitHook.error) {
      console.log(`  ⚠ git pre-commit skipped: ${result.gitHook.error}`);
    }
    console.log(
      "  Restart Cursor (or reload hooks) to activate gate-guard / drift-watcher / learn-prompt.",
    );
    return { changed: true };
  } catch (error) {
    console.log(`[Hooks] skipped: ${error.message}`);
    return { changed: false };
  }
}

function installProjectMcp(targetRoot, agents) {
  try {
    const agentIds = agents.map((agent) => agent.id);
    const result = installMcp(targetRoot, { agentIds });
    const changedItems = (result.installed || []).filter((item) => item.changed);
    if (!result.changed) {
      return { changed: false };
    }
    console.log("[MCP]");
    for (const item of changedItems) {
      console.log(`  ✓ ${item.label}: ${item.configRel} → server "${item.server}"`);
    }
    for (const configRel of result.pruned || []) {
      console.log(`  ✓ removed stale MCP: ${configRel}`);
    }
    if (result.entry && changedItems.length) {
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
    return { changed: true };
  } catch (error) {
    console.log(`[MCP] skipped: ${error.message}`);
    return { changed: false };
  }
}

function installProjectFivem(targetRoot) {
  try {
    const result = fivemRcon.installFivemDev({ root: path.resolve(targetRoot) });
    if (!result.changed) {
      return { changed: false };
    }
    console.log("[FiveM]");
    for (const step of result.steps || []) {
      if (!step.action || step.action === "kept" || step.action === "found") {
        continue;
      }
      const detail = [step.path, step.action].filter(Boolean).join(" ");
      console.log(`  ✓ ${step.step}: ${detail}`);
    }
    for (const warning of result.warnings || []) {
      console.log(`  ⚠ ${warning}`);
    }
    if (result.note && result.needsServerRestart) {
      console.log(`  ${result.note}`);
    }
    return { changed: true };
  } catch (error) {
    console.log(`[FiveM] skipped: ${error.message}`);
    return { changed: false };
  }
}

function installProjectCursorIntegration(targetRoot, options, agents, packs = []) {
  let changed = false;
  if (shouldInstallHooks(options, agents)) {
    changed = installProjectHooks(targetRoot).changed || changed;
  }
  if (shouldInstallMcp(options, agents)) {
    changed = installProjectMcp(targetRoot, agents).changed || changed;
  }
  if (shouldRefreshFivem(options, packs)) {
    changed = installProjectFivem(targetRoot).changed || changed;
  }
  return { changed };
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
