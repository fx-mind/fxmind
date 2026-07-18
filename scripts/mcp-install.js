/**
 * fxmind MCP — wire project MCP configs for all supported agents.
 */

const fs = require("fs");
const path = require("path");

const MCP_SERVER_KEY = "fxmind";
const FXMIND_MCP_COMMAND = "fxmind-mcp";
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

function buildFxmindMcpEntry() {
  // Requires: npm install -g github:fx-mind/fxmind
  //
  // Windows/Cursor: Electron spawn(shell:false) cannot run npm shims
  // (`fxmind-mcp` / `.cmd`) → ENOENT → Cursor marks the server disabled.
  // Use `node` + the global script via APPDATA interpolation instead.
  const entry = {
    type: "stdio",
    env: {
      FXMIND_TARGET: "${workspaceFolder}",
    },
  };

  if (process.platform === "win32") {
    entry.command = "node";
    entry.args = [
      "${env:APPDATA}/npm/node_modules/fxmind/scripts/mcp-server.js",
    ];
  } else {
    entry.command = FXMIND_MCP_COMMAND;
  }

  // Optional local FXServer RCON (IDE task). Set password in project mcp.json or env.
  if (process.env.FXMIND_RCON_PASSWORD) {
    entry.env.FXMIND_RCON_PASSWORD = process.env.FXMIND_RCON_PASSWORD;
  }
  if (process.env.FXMIND_RCON_HOST) {
    entry.env.FXMIND_RCON_HOST = process.env.FXMIND_RCON_HOST;
  }
  if (process.env.FXMIND_RCON_PORT) {
    entry.env.FXMIND_RCON_PORT = process.env.FXMIND_RCON_PORT;
  }
  if (process.env.FXMIND_FIVEM_LOG) {
    entry.env.FXMIND_FIVEM_LOG = process.env.FXMIND_FIVEM_LOG;
  }

  return entry;
}

function tomlString(value) {
  return JSON.stringify(String(value));
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
  return `\n[mcp_servers.fxmind]\ncommand = ${tomlString(entry.command)}\n`;
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

function resolveOpenCodeMcpLaunch() {
  return {
    type: "local",
    command: [FXMIND_MCP_COMMAND],
    enabled: true,
  };
}

function installOpenCodeMcp(configPath) {
  const existing = readJson(configPath, {
    $schema: "https://opencode.ai/config.json",
    mcp: {},
  });
  existing.mcp = existing.mcp || {};
  existing.mcp[MCP_SERVER_KEY] = resolveOpenCodeMcpLaunch();
  writeJson(configPath, existing);
}

function removeLegacyOpenCodeMcpJson(projectRoot) {
  const legacyPath = path.join(path.resolve(projectRoot), ".opencode", "mcp.json");
  if (!fs.existsSync(legacyPath)) {
    return false;
  }
  const existing = readJson(legacyPath);
  const hasFxmind =
    existing?.servers?.[MCP_SERVER_KEY] || existing?.mcp?.[MCP_SERVER_KEY];
  if (!hasFxmind) {
    return false;
  }
  if (existing.servers?.[MCP_SERVER_KEY]) {
    delete existing.servers[MCP_SERVER_KEY];
    if (Object.keys(existing.servers).length === 0) {
      delete existing.servers;
    }
  }
  if (existing.mcp?.[MCP_SERVER_KEY]) {
    delete existing.mcp[MCP_SERVER_KEY];
    if (Object.keys(existing.mcp).length === 0) {
      delete existing.mcp;
    }
  }
  const remainingKeys = Object.keys(existing).filter((key) => key !== "$schema");
  if (remainingKeys.length === 0) {
    fs.unlinkSync(legacyPath);
  } else {
    writeJson(legacyPath, existing);
  }
  return true;
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
  const configPath = path.join(projectRoot, target.configRel);
  const entry = buildFxmindMcpEntry();

  if (agentId === "opencode") {
    installOpenCodeMcp(configPath);
    removeLegacyOpenCodeMcpJson(projectRoot);
  } else if (target.format === "mcpServers-json") {
    installMcpServersJson(configPath, entry);
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
  FXMIND_MCP_COMMAND,
  MCP_AGENT_TARGETS,
  installMcp,
  uninstallMcp,
  mcpStatus,
  installMcpForAgent,
  uninstallMcpForAgent,
  mcpStatusForAgent,
  resolveMcpAgentIds,
  buildFxmindMcpEntry,
  resolveOpenCodeMcpLaunch,
};
