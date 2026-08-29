/**
 * panel-api — pure handlers for the FxMind web panel HTTP API.
 * All project intelligence goes through fxmind-tools / global-store.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  REGISTRY_PATH,
  projectIdForRoot,
  listRegisteredProjects,
} = require("../global-store");
const tools = require("../fxmind-tools");

function panelConfigPath() {
  return path.join(os.homedir(), ".fxmind", "panel.json");
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
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

function keyPrefix(integrationKey) {
  const key = String(integrationKey || "").trim();
  if (key.length <= 8) return key ? "****" : "";
  return `${key.slice(0, 8)}…`;
}

function readPanelConfig() {
  return readJson(panelConfigPath(), { version: 1, portspace: null });
}

function writePanelConfig(data) {
  writeJson(panelConfigPath(), data);
}

function listProjects(cwd = process.cwd()) {
  const registry = readJson(REGISTRY_PATH, { version: 1, projects: {} });
  const registered = listRegisteredProjects();
  const byId = new Map();

  for (const project of registered) {
    byId.set(project.id, {
      id: project.id,
      name: project.name,
      root: project.root,
      registeredAt: project.registeredAt,
      updatedAt: project.updatedAt,
      packs: project.packs || [],
      source: "registry",
    });
  }

  const resolvedCwd = path.resolve(cwd).replace(/\\/g, "/");
  const cwdId = projectIdForRoot(resolvedCwd);
  if (!byId.has(cwdId)) {
    byId.set(cwdId, {
      id: cwdId,
      name: path.basename(resolvedCwd) || "project",
      root: resolvedCwd,
      source: "cwd",
    });
  }

  return {
    registryVersion: registry.version ?? 1,
    projects: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function resolveProjectRoot(projectId, cwd = process.cwd()) {
  if (!projectId) {
    return { ok: false, status: 400, error: "project id required" };
  }

  const { projects } = listProjects(cwd);
  const match = projects.find((p) => p.id === projectId);
  if (!match) {
    return { ok: false, status: 404, error: "project not found" };
  }

  const root = path.resolve(match.root);
  if (!fs.existsSync(root)) {
    return { ok: false, status: 404, error: "project root missing on disk" };
  }

  return { ok: true, root, project: match };
}

function getHealth() {
  return {
    ok: true,
    service: "fxmind-panel",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  };
}

function getPortspaceSettings() {
  const config = readPanelConfig();
  const portspace = config.portspace || {};
  const key = String(portspace.integrationKey || "").trim();

  return {
    baseUrl: portspace.baseUrl || "",
    hasKey: Boolean(key),
    keyPrefix: key ? keyPrefix(key) : "",
    updatedAt: portspace.updatedAt || null,
  };
}

function putPortspaceSettings(body = {}) {
  const config = readPanelConfig();
  const prev = config.portspace || {};
  const baseUrl = String(body.baseUrl ?? prev.baseUrl ?? "").trim().replace(/\/+$/, "");
  let integrationKey = prev.integrationKey || "";

  if (body.integrationKey !== undefined) {
    const next = String(body.integrationKey || "").trim();
    if (next) integrationKey = next;
  }

  if (body.clearKey === true) {
    integrationKey = "";
  }

  config.portspace = {
    baseUrl,
    integrationKey,
    updatedAt: new Date().toISOString(),
  };
  writePanelConfig(config);

  return getPortspaceSettings();
}

function getCursorApiKey() {
  const config = readPanelConfig();
  const stored = String(config.cursor?.apiKey || "").trim();
  return stored || String(process.env.CURSOR_API_KEY || "").trim();
}

function getCursorSettings() {
  const key = getCursorApiKey();
  const config = readPanelConfig();
  return {
    hasKey: Boolean(key),
    keyPrefix: key ? keyPrefix(key) : "",
    fromEnv: Boolean(String(process.env.CURSOR_API_KEY || "").trim()) && !config.cursor?.apiKey,
    updatedAt: config.cursor?.updatedAt || null,
  };
}

function putCursorSettings(body = {}) {
  const config = readPanelConfig();
  const prev = config.cursor || {};
  let apiKey = prev.apiKey || "";

  if (body.apiKey !== undefined) {
    const next = String(body.apiKey || "").trim();
    if (next) apiKey = next;
  }
  if (body.clearKey === true) apiKey = "";

  config.cursor = {
    apiKey,
    updatedAt: new Date().toISOString(),
  };
  writePanelConfig(config);
  return getCursorSettings();
}

async function fetchPortspaceInbox(configOverride = null) {
  const config = configOverride || readPanelConfig();
  const portspace = config.portspace || {};
  const baseUrl = String(portspace.baseUrl || "").trim().replace(/\/+$/, "");
  const integrationKey = String(portspace.integrationKey || "").trim();

  if (!baseUrl || !integrationKey) {
    return {
      configured: false,
      ok: false,
      items: [],
      date: new Date().toISOString().slice(0, 10),
    };
  }

  const url = `${baseUrl}/external/fxmind/inbox`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-integration-key": integrationKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (res.status === 404) {
      return {
        configured: true,
        ok: false,
        error: "endpoint_not_found",
        message: "PortSpace API does not expose /external/fxmind/inbox yet",
        items: [],
        date: new Date().toISOString().slice(0, 10),
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        configured: true,
        ok: false,
        error: "upstream_error",
        status: res.status,
        message: text.slice(0, 200) || res.statusText,
        items: [],
        date: new Date().toISOString().slice(0, 10),
      };
    }

    const data = await res.json();
    return {
      configured: true,
      ok: true,
      date: data.date || new Date().toISOString().slice(0, 10),
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      configured: true,
      ok: false,
      error: aborted ? "timeout" : "network_error",
      message: aborted ? "Request timed out" : String(err?.message || err),
      items: [],
      date: new Date().toISOString().slice(0, 10),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getProjectMemories(projectId, cwd = process.cwd()) {
  const resolved = resolveProjectRoot(projectId, cwd);
  if (!resolved.ok) return resolved;
  return { ok: true, memories: tools.listMemories(resolved.root) };
}

function validateProjectMemories(projectId, cwd = process.cwd()) {
  const resolved = resolveProjectRoot(projectId, cwd);
  if (!resolved.ok) return resolved;
  return { ok: true, ...tools.validateMemories(resolved.root) };
}

function queryProject(projectId, body = {}, cwd = process.cwd()) {
  const resolved = resolveProjectRoot(projectId, cwd);
  if (!resolved.ok) return resolved;

  const question = String(body.question || "").trim();
  if (!question) {
    return { ok: false, status: 400, error: "question is required" };
  }

  const budget = Number(body.budget) || 1500;
  const result = tools.queryGraph(resolved.root, question, {
    budget,
    dfs: Boolean(body.dfs),
  });

  return { ok: true, ...result };
}

function getProjectGates(projectId, cwd = process.cwd()) {
  const resolved = resolveProjectRoot(projectId, cwd);
  if (!resolved.ok) return resolved;
  return { ok: true, gates: tools.gateStatus(resolved.root) };
}

function getProjectCorrections(projectId, cwd = process.cwd()) {
  const resolved = resolveProjectRoot(projectId, cwd);
  if (!resolved.ok) return resolved;
  return { ok: true, corrections: tools.listCorrections(resolved.root) };
}

module.exports = {
  panelConfigPath,
  readPanelConfig,
  writePanelConfig,
  keyPrefix,
  listProjects,
  resolveProjectRoot,
  getHealth,
  getPortspaceSettings,
  putPortspaceSettings,
  getCursorApiKey,
  getCursorSettings,
  putCursorSettings,
  fetchPortspaceInbox,
  getProjectMemories,
  validateProjectMemories,
  queryProject,
  getProjectGates,
  getProjectCorrections,
};
