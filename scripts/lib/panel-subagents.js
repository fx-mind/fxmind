/**
 * Subagent settings — provider-agnostic panel defaults (model/variant/cliId
 * per subagent id), plus OpenCode's own native `.opencode/agents/*.md` +
 * opencode.json sync (a fast-path OpenCode's runtime can use directly,
 * without going through the fxmind_subagent_run MCP tool). Every provider
 * can run these subagents via that MCP tool (see panel-cli.js:runSubagentTask)
 * regardless of whether the OpenCode files are installed in this project.
 */

const fs = require("fs");
const path = require("path");
const { readPanelConfig, writePanelConfig } = require("./panel-api");
const { OPENCODE_SUBAGENT_NAMES, OPENCODE_CONFIG_REL } = require("../install/config");

const SUBAGENT_META = {
  explore: {
    label: "Explore",
    description: "Gate B via fxmind_query/MCP — não grep manual.",
  },
  reader: {
    label: "Reader",
    description: "Lê paths conhecidos e extrai trechos curtos.",
  },
  general: {
    label: "General",
    description: "Implementação limitada e comandos pontuais.",
  },
  scout: {
    label: "Scout",
    description: "Documentação e fontes externas (fora do repo).",
  },
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

function opencodeConfigPath(projectRoot) {
  return path.join(path.resolve(projectRoot), OPENCODE_CONFIG_REL);
}

function agentFilePath(projectRoot, id) {
  return path.join(path.resolve(projectRoot), ".opencode", "agents", `${id}.md`);
}

function isSubagentInstalled(projectRoot, id) {
  return fs.existsSync(agentFilePath(projectRoot, id));
}

function subagentsInstalled(projectRoot) {
  return OPENCODE_SUBAGENT_NAMES.every((id) => isSubagentInstalled(projectRoot, id));
}

function readPanelSubagentDefaults() {
  const config = readPanelConfig();
  const raw = config.agent?.subagents;
  return raw && typeof raw === "object" ? raw : {};
}

function normalizeEntry(entry = {}) {
  const model = entry.model !== undefined && entry.model !== null ? String(entry.model).trim() : "";
  const variant =
    entry.variant !== undefined && entry.variant !== null ? String(entry.variant).trim() : "";
  const cliId = entry.cliId !== undefined && entry.cliId !== null ? String(entry.cliId).trim() : "";
  return {
    model: model || null,
    variant: variant || null,
    // Which provider actually runs this subagent — independent of the
    // primary agent's provider. This is what makes subagents work for every
    // CLI (via the fxmind_subagent_run MCP tool), not just OpenCode's own
    // native delegation. Not synced to opencode.json (OpenCode has no
    // concept of "run this subagent on a different CLI").
    cliId: cliId || null,
  };
}

function mergeSubagentEntry(id, panelDefaults, opencodeAgent = {}) {
  const meta = SUBAGENT_META[id] || { label: id, description: "" };
  const fromPanel = normalizeEntry(panelDefaults[id]);
  const fromProject = normalizeEntry(opencodeAgent);
  return {
    id,
    label: meta.label,
    description: meta.description,
    mode: opencodeAgent.mode || "subagent",
    model: fromProject.model || fromPanel.model || null,
    variant: fromProject.variant || fromPanel.variant || null,
    cliId: fromPanel.cliId || null,
    installed: false,
  };
}

function getSubagentSettings(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const panelDefaults = readPanelSubagentDefaults();
  const configPath = opencodeConfigPath(root);
  const opencode = readJson(configPath, null);
  const agents = opencode?.agent && typeof opencode.agent === "object" ? opencode.agent : {};

  const subagents = OPENCODE_SUBAGENT_NAMES.map((id) => {
    const entry = mergeSubagentEntry(id, panelDefaults, agents[id] || {});
    entry.installed = isSubagentInstalled(root, id);
    return entry;
  });

  return {
    ok: true,
    projectRoot: root,
    opencodeConfigExists: fs.existsSync(configPath),
    installed: subagentsInstalled(root),
    subagents,
  };
}

function putPanelSubagentDefaults(subagents = {}) {
  const config = readPanelConfig();
  config.agent = config.agent && typeof config.agent === "object" ? config.agent : {};
  const next = { ...(config.agent.subagents || {}) };
  for (const id of OPENCODE_SUBAGENT_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(subagents, id)) continue;
    const normalized = normalizeEntry(subagents[id]);
    next[id] = normalized;
  }
  config.agent.subagents = next;
  config.agent.updatedAt = new Date().toISOString();
  writePanelConfig(config);
}

function syncProjectOpenCodeConfig(projectRoot, subagents = {}) {
  const root = path.resolve(projectRoot);
  const configPath = opencodeConfigPath(root);
  const existing =
    readJson(configPath, {
      $schema: "https://opencode.ai/config.json",
    }) || { $schema: "https://opencode.ai/config.json" };

  existing.agent = existing.agent && typeof existing.agent === "object" ? existing.agent : {};

  for (const id of OPENCODE_SUBAGENT_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(subagents, id)) continue;
    const normalized = normalizeEntry(subagents[id]);
    const prev =
      existing.agent[id] && typeof existing.agent[id] === "object" ? existing.agent[id] : {};
    const next = { ...prev, mode: "subagent" };
    if (normalized.model) next.model = normalized.model;
    else delete next.model;
    if (normalized.variant) next.variant = normalized.variant;
    else delete next.variant;
    existing.agent[id] = next;
  }

  writeJson(configPath, existing);
  return configPath;
}

function putSubagentSettings(projectRoot, body = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  if (!root || !fs.existsSync(root)) {
    return { ok: false, status: 400, error: "project root missing" };
  }

  let installed = subagentsInstalled(root);
  if (body.install === true && !installed) {
    try {
      const { installOpenCodeSubagents } = require("../install/opencode");
      installOpenCodeSubagents(root);
      installed = subagentsInstalled(root);
    } catch (err) {
      return { ok: false, status: 500, error: String(err.message || err) };
    }
  }

  const subagents = body.subagents && typeof body.subagents === "object" ? body.subagents : {};
  putPanelSubagentDefaults(subagents);

  if (installed || fs.existsSync(opencodeConfigPath(root))) {
    try {
      syncProjectOpenCodeConfig(root, subagents);
    } catch (err) {
      return { ok: false, status: 500, error: String(err.message || err) };
    }
  }

  return getSubagentSettings(root);
}

module.exports = {
  SUBAGENT_META,
  OPENCODE_SUBAGENT_NAMES,
  getSubagentSettings,
  putSubagentSettings,
  readPanelSubagentDefaults,
  syncProjectOpenCodeConfig,
  subagentsInstalled,
};
