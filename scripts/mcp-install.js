/**
 * fxmind MCP — wire project MCP configs for all supported agents.
 */

const fs = require("fs");
const path = require("path");

const { PACKAGE_ROOT } = require("./resolve-packs");
const { GITHUB_PKG } = require("./constants");

/** Resolved at runtime by Cursor / Claude Code (not a literal path). */
const WORKSPACE_ROOT = "${workspaceFolder}";

const MCP_SERVER_KEY = "fxmind";
const MANIFEST_REL = path.join(".fxmind", "packs.json");

const MCP_AGENT_TARGETS = {
  cursor: {
    label: "Cursor",
    configRel: path.join(".cursor", "mcp.json"),
    format: "mcpServers-json",
  },
  claude: {
    label: "Claude Code",
    configRel: ".mcp.json",
    format: "mcpServers-json",
  },
  gemini: {
    label: "Gemini CLI",
    configRel: path.join(".gemini", "settings.json"),
    format: "mcpServers-json",
  },
  opencode: {
    label: "OpenCode",
    configRel: "opencode.json",
    format: "opencode-mcp",
  },
  codex: {
    label: "Codex",
    configRel: path.join(".codex", "config.toml"),
    format: "codex-toml",
  },
};

const MCP_JSON_REL = MCP_AGENT_TARGETS.cursor.configRel;

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
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

function resolveMcpLaunch() {
  // Portable for committed .cursor/mcp.json — no global install or machine-specific paths.
  return {
    command: "npx",
    args: ["-y", "-p", GITHUB_PKG, "fxmind-mcp"],
  };
}

function buildFxmindMcpEntry(_projectRoot, _packageRoot = PACKAGE_ROOT) {
  const launch = resolveMcpLaunch();
  return {
    command: launch.command,
    args: launch.args,
    cwd: WORKSPACE_ROOT,
    env: {
      FXMIND_TARGET: WORKSPACE_ROOT,
    },
  };
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlInlineArray(values) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function normalizeAgentIds(agentIds) {
  if (!Array.isArray(agentIds)) {
    return [];
  }
  return [...new Set(agentIds.filter((agentId) => MCP_AGENT_TARGETS[agentId]))];
}

function readManifestAgentIds(targetRoot) {
  const manifestPath = path.join(path.resolve(targetRoot), MANIFEST_REL);
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest?.agents)) {
    return [];
  }
  return normalizeAgentIds(manifest.agents);
}

function hasAgentInstallMarker(targetRoot, agentId) {
  const projectRoot = path.resolve(targetRoot);
  const markers = {
    cursor: [
      path.join(".cursor", "commands", "fxmind.md"),
      path.join(".cursor", "skills", "fxmind"),
    ],
    claude: [
      path.join(".claude", "commands", "fxmind.md"),
      path.join(".claude", "skills", "fxmind"),
    ],
    codex: [
      path.join(".agents", "skills", "fxmind"),
      path.join(".codex", "skills", "fxmind"),
    ],
    gemini: [
      path.join(".gemini", "commands", "fxmind.toml"),
      path.join(".gemini", "skills", "fxmind"),
      path.join(".agents", "skills", "fxmind"),
    ],
    opencode: [
      path.join(".opencode", "commands", "fxmind.md"),
      path.join(".opencode", "skills", "fxmind"),
    ],
  };

  return (markers[agentId] || []).some((relPath) => fs.existsSync(path.join(projectRoot, relPath)));
}

function detectInstalledMcpAgentIds(targetRoot) {
  const projectRoot = path.resolve(targetRoot);
  return Object.keys(MCP_AGENT_TARGETS).filter((agentId) => {
    const configPath = path.join(projectRoot, MCP_AGENT_TARGETS[agentId].configRel);
    return fs.existsSync(configPath) || hasAgentInstallMarker(projectRoot, agentId);
  });
}

function resolveMcpAgentIds(targetRoot, agentIds) {
  const explicit = normalizeAgentIds(agentIds);
  if (explicit.length) {
    return explicit;
  }

  const fromManifest = readManifestAgentIds(targetRoot);
  if (fromManifest.length) {
    return fromManifest;
  }

  const fromDisk = detectInstalledMcpAgentIds(targetRoot);
  if (fromDisk.length) {
    return fromDisk;
  }

  return ["cursor"];
}

function buildCodexMcpToml(entry) {
  const lines = ["", "[mcp_servers.fxmind]", `command = ${tomlString(entry.command)}`];
  if (entry.args?.length) {
    lines.push(`args = ${tomlInlineArray(entry.args)}`);
  }
  if (entry.cwd) {
    lines.push(`cwd = ${tomlString(entry.cwd)}`);
  }
  lines.push("", "[mcp_servers.fxmind.env]");
  for (const [key, value] of Object.entries(entry.env || {})) {
    lines.push(`${key} = ${tomlString(value)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function removeCodexMcpSection(content) {
  let next = content.replace(
    /(?:^|\r?\n)\[mcp_servers\.fxmind\.env\][\s\S]*?(?=\r?\n\[|$)/g,
    "",
  );
  next = next.replace(/(?:^|\r?\n)\[mcp_servers\.fxmind\][\s\S]*?(?=\r?\n\[|$)/g, "");
  return next.trimEnd();
}

function installMcpServersJson(configPath, entry) {
  const existing = readJson(configPath, { mcpServers: {} });
  existing.mcpServers = existing.mcpServers || {};
  existing.mcpServers[MCP_SERVER_KEY] = entry;
  writeJson(configPath, existing);
}

function uninstallMcpServersJson(configPath) {
  const existing = readJson(configPath);
  if (!existing?.mcpServers?.[MCP_SERVER_KEY]) {
    return false;
  }

  delete existing.mcpServers[MCP_SERVER_KEY];
  if (Object.keys(existing.mcpServers).length === 0) {
    fs.unlinkSync(configPath);
  } else {
    writeJson(configPath, existing);
  }
  return true;
}

function mcpStatusMcpServersJson(configPath) {
  const existing = readJson(configPath);
  const entry = existing?.mcpServers?.[MCP_SERVER_KEY] || null;
  return {
    configExists: fs.existsSync(configPath),
    installed: Boolean(entry),
    entry,
  };
}

function installOpenCodeMcp(configPath, entry) {
  const existing = readJson(configPath, {
    $schema: "https://opencode.ai/config.json",
    mcp: {},
  });
  existing.mcp = existing.mcp || {};
  existing.mcp[MCP_SERVER_KEY] = {
    type: "local",
    command: [entry.command, ...(entry.args || [])],
    cwd: entry.cwd,
    environment: entry.env,
    enabled: true,
  };
  writeJson(configPath, existing);
}

function uninstallOpenCodeMcp(configPath) {
  const existing = readJson(configPath);
  if (!existing?.mcp?.[MCP_SERVER_KEY]) {
    return false;
  }

  delete existing.mcp[MCP_SERVER_KEY];
  if (Object.keys(existing.mcp).length === 0) {
    delete existing.mcp;
  }

  const remainingKeys = Object.keys(existing).filter((key) => key !== "$schema");
  if (remainingKeys.length === 0) {
    fs.unlinkSync(configPath);
  } else {
    writeJson(configPath, existing);
  }
  return true;
}

function mcpStatusOpenCode(configPath) {
  const existing = readJson(configPath);
  const raw = existing?.mcp?.[MCP_SERVER_KEY] || null;
  const entry = raw
    ? {
        command: raw.command?.[0] || null,
        args: raw.command?.slice(1) || [],
        cwd: raw.cwd || null,
        env: raw.environment || {},
      }
    : null;
  return {
    configExists: fs.existsSync(configPath),
    installed: Boolean(raw),
    entry,
  };
}

function installCodexMcp(configPath, entry) {
  const block = buildCodexMcpToml(entry);
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const cleaned = removeCodexMcpSection(existing);
  const next = cleaned.length ? `${cleaned}${block}` : `${block.trimStart()}\n`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, next, "utf8");
}

function uninstallCodexMcp(configPath) {
  if (!fs.existsSync(configPath)) {
    return false;
  }

  const existing = fs.readFileSync(configPath, "utf8");
  if (!/\[mcp_servers\.fxmind\]/.test(existing)) {
    return false;
  }

  const next = removeCodexMcpSection(existing);
  if (!next.trim()) {
    fs.unlinkSync(configPath);
  } else {
    fs.writeFileSync(configPath, `${next}\n`, "utf8");
  }
  return true;
}

function mcpStatusCodex(configPath) {
  if (!fs.existsSync(configPath)) {
    return { configExists: false, installed: false, entry: null };
  }

  const content = fs.readFileSync(configPath, "utf8");
  const installed = /\[mcp_servers\.fxmind\]/.test(content);
  if (!installed) {
    return { configExists: true, installed: false, entry: null };
  }

  const commandMatch = content.match(/\[mcp_servers\.fxmind\][\s\S]*?^command\s*=\s*(.+)$/m);
  const argsMatch = content.match(/\[mcp_servers\.fxmind\][\s\S]*?^args\s*=\s*(.+)$/m);
  const envMatch = content.match(
    /\[mcp_servers\.fxmind\.env\][\s\S]*?^FXMIND_TARGET\s*=\s*(.+)$/m,
  );

  let command = null;
  if (commandMatch) {
    try {
      command = JSON.parse(commandMatch[1].trim());
    } catch {
      command = commandMatch[1].trim().replace(/^"|"$/g, "");
    }
  }

  let args = [];
  if (argsMatch) {
    try {
      args = JSON.parse(argsMatch[1].trim());
    } catch {
      args = [];
    }
  }

  let fxmindTarget = null;
  if (envMatch) {
    try {
      fxmindTarget = JSON.parse(envMatch[1].trim());
    } catch {
      fxmindTarget = envMatch[1].trim().replace(/^"|"$/g, "");
    }
  }

  return {
    configExists: true,
    installed: true,
    entry: command
      ? {
          command,
          args,
          env: fxmindTarget ? { FXMIND_TARGET: fxmindTarget } : {},
        }
      : null,
  };
}

function installMcpForAgent(targetRoot, agentId, options = {}) {
  const target = MCP_AGENT_TARGETS[agentId];
  if (!target) {
    throw new Error(`Unknown MCP agent: ${agentId}`);
  }

  const projectRoot = path.resolve(targetRoot);
  const packageRoot = options.packageRoot || PACKAGE_ROOT;
  const configPath = path.join(projectRoot, target.configRel);
  const entry = buildFxmindMcpEntry(projectRoot, packageRoot);

  if (target.format === "mcpServers-json") {
    installMcpServersJson(configPath, entry);
  } else if (target.format === "opencode-mcp") {
    installOpenCodeMcp(configPath, entry);
  } else if (target.format === "codex-toml") {
    installCodexMcp(configPath, entry);
  } else {
    throw new Error(`Unsupported MCP format: ${target.format}`);
  }

  return {
    agentId,
    label: target.label,
    configRel: target.configRel.replace(/\\/g, "/"),
    server: MCP_SERVER_KEY,
    entry,
  };
}

function uninstallMcpForAgent(targetRoot, agentId) {
  const target = MCP_AGENT_TARGETS[agentId];
  if (!target) {
    return { agentId, removed: false, configRel: null };
  }

  const configPath = path.join(path.resolve(targetRoot), target.configRel);
  let removed = false;

  if (target.format === "mcpServers-json") {
    removed = uninstallMcpServersJson(configPath);
  } else if (target.format === "opencode-mcp") {
    removed = uninstallOpenCodeMcp(configPath);
  } else if (target.format === "codex-toml") {
    removed = uninstallCodexMcp(configPath);
  }

  return {
    agentId,
    label: target.label,
    removed,
    configRel: target.configRel.replace(/\\/g, "/"),
  };
}

function mcpStatusForAgent(targetRoot, agentId) {
  const target = MCP_AGENT_TARGETS[agentId];
  if (!target) {
    return { agentId, installed: false, configExists: false, entry: null, configRel: null };
  }

  const configPath = path.join(path.resolve(targetRoot), target.configRel);
  let status;
  if (target.format === "mcpServers-json") {
    status = mcpStatusMcpServersJson(configPath);
  } else if (target.format === "opencode-mcp") {
    status = mcpStatusOpenCode(configPath);
  } else if (target.format === "codex-toml") {
    status = mcpStatusCodex(configPath);
  } else {
    status = { configExists: false, installed: false, entry: null };
  }

  return {
    agentId,
    label: target.label,
    configRel: target.configRel.replace(/\\/g, "/"),
    ...status,
  };
}

function installMcp(targetRoot, options = {}) {
  const agentIds = resolveMcpAgentIds(targetRoot, options.agentIds);
  const installed = agentIds.map((agentId) => installMcpForAgent(targetRoot, agentId, options));
  const primary = installed.find((item) => item.agentId === "cursor") || installed[0] || null;

  return {
    agentIds,
    installed,
    server: MCP_SERVER_KEY,
    mcpJson: primary?.configRel || MCP_JSON_REL.replace(/\\/g, "/"),
    entry: primary?.entry || null,
  };
}

function uninstallMcp(targetRoot, options = {}) {
  const agentIds = resolveMcpAgentIds(targetRoot, options.agentIds);
  const results = agentIds.map((agentId) => uninstallMcpForAgent(targetRoot, agentId));
  const removed = results.filter((result) => result.removed).map((result) => result.configRel);

  return {
    agentIds,
    results,
    removed,
  };
}

function mcpStatus(targetRoot, options = {}) {
  const agentIds = resolveMcpAgentIds(targetRoot, options.agentIds);
  const agents = agentIds.map((agentId) => mcpStatusForAgent(targetRoot, agentId));
  const primary = agents.find((item) => item.agentId === "cursor") || agents[0] || null;

  return {
    agentIds,
    agents,
    mcpJsonExists: primary?.configExists || false,
    installed: agents.some((item) => item.installed),
    entry: primary?.entry || null,
  };
}

module.exports = {
  MCP_JSON_REL,
  MCP_SERVER_KEY,
  MCP_AGENT_TARGETS,
  installMcp,
  uninstallMcp,
  mcpStatus,
  installMcpForAgent,
  uninstallMcpForAgent,
  mcpStatusForAgent,
  resolveMcpAgentIds,
  buildFxmindMcpEntry,
  resolveMcpLaunch,
};
