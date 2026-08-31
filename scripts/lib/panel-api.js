/**
 * panel-api — pure handlers for the FxMind web panel HTTP API.
 * All project intelligence goes through fxmind-tools / global-store.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawn } = require("child_process");
const {
  REGISTRY_PATH,
  projectIdForRoot,
  listRegisteredProjects,
  resolveDataRoot,
} = require("../global-store");
const { resolveInDataRoot } = require("./layout");
const tools = require("../fxmind-tools");

function normalizeRoot(dir) {
  return path.resolve(dir).replace(/\\/g, "/");
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PROJECT_ICON_BYTES = 5 * 1024 * 1024;
const PREFERRED_ROOT_PNG_NAMES = [
  "logo.png",
  "icon.png",
  "avatar.png",
  "favicon.png",
  "brand.png",
];

function isPngFile(filePath) {
  let fd = null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < PNG_SIGNATURE.length || stat.size > MAX_PROJECT_ICON_BYTES) {
      return false;
    }
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(PNG_SIGNATURE.length);
    fs.readSync(fd, header, 0, header.length, 0);
    return header.equals(PNG_SIGNATURE);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function rootPngPath(root) {
  try {
    const candidates = fs
      .readdirSync(path.resolve(root), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
      .map((entry) => path.join(path.resolve(root), entry.name))
      .filter(isPngFile);
    candidates.sort((a, b) => {
      const aName = path.basename(a).toLowerCase();
      const bName = path.basename(b).toLowerCase();
      const aPriority = PREFERRED_ROOT_PNG_NAMES.indexOf(aName);
      const bPriority = PREFERRED_ROOT_PNG_NAMES.indexOf(bName);
      const normalizedA = aPriority === -1 ? 100 : aPriority;
      const normalizedB = bPriority === -1 ? 100 : bPriority;
      return normalizedA - normalizedB || aName.localeCompare(bName);
    });
    return candidates[0] || null;
  } catch {
    return null;
  }
}

/** Nearest directory that contains `.fxmind/`, otherwise the resolved path. */
function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, ".fxmind"))) return normalizeRoot(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return normalizeRoot(start || process.cwd());
    dir = parent;
  }
}

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

function graphValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return String(value.id);
  return "";
}

function concreteResources(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(/[,;|]/);
  return new Set(
    values
      .map((item) => String(item).trim().toLowerCase())
      .filter((item) => item && !/^\[[^\]]+\]$/.test(item)),
  );
}

function concretePaths(value) {
  const pathExtensions = [
    ".cfg", ".css", ".html", ".js", ".json", ".lua", ".md", ".sql", ".ts",
    ".tsx", ".vue",
  ];
  const values = Array.isArray(value) ? value : String(value || "").split(/[,;|]/);
  return values
    .map((item) => String(item).trim().replace(/^["'`]|["'`]$/g, ""))
    .filter((item) => {
      if (
        !item ||
        item.length > 240 ||
        item.startsWith("/") ||
        /[\r\n—*]/.test(item) ||
        /\s/.test(item)
      ) {
        return false;
      }
      const lower = item.toLowerCase();
      return (
        lower.includes("/") ||
        lower.includes("\\") ||
        pathExtensions.some((extension) => lower.endsWith(extension))
      );
    });
}

function linkablePaths(value) {
  return concretePaths(value).filter((item) => /^(?:resources|\.fxmind)[/\\]/i.test(item));
}

function pathsSharePrefix(source, target) {
  return linkablePaths(source).some((sourcePath) =>
    linkablePaths(target).some(
      (targetPath) =>
        sourcePath === targetPath ||
        sourcePath.includes(targetPath) ||
        targetPath.includes(sourcePath),
    ),
  );
}

const GENERIC_EVENT_NAMESPACES = new Set([
  "client", "core", "event", "events", "fivem", "main", "player", "resource",
  "server", "shared", "system",
]);

function eventNamespaces(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,;|]/);
  return new Set(
    values
      .map((item) => String(item).trim().toLowerCase())
      .map((item) => {
        const separator = item.indexOf(":");
        return separator >= 3 ? item.slice(0, separator) : "";
      })
      .filter(
        (namespace) =>
          namespace.length >= 3 &&
          /^[a-z0-9_-]+$/.test(namespace) &&
          !GENERIC_EVENT_NAMESPACES.has(namespace),
      ),
  );
}

function eventsShareNamespace(source, target) {
  const sourceNamespaces = eventNamespaces(source);
  return [...eventNamespaces(target)].some((namespace) => sourceNamespaces.has(namespace));
}

function isConfirmedGraphLink(link, nodesById) {
  if (!link || typeof link !== "object") return false;
  const relationType = String(link.type || link.kind || "").toLowerCase();
  const source = nodesById.get(graphValue(link.source));
  const target = nodesById.get(graphValue(link.target));
  if (relationType === "event-domain") {
    return Boolean(source && target && eventsShareNamespace(source.events, target.events));
  }
  if (
    String(link.confidence || "").toLowerCase() === "inferred" ||
    ["shared-symbol", "cross-mention", "domain-related"].includes(relationType)
  ) {
    return false;
  }
  if (relationType !== "shared-resource" && relationType !== "shared-path") {
    return true;
  }

  if (!source || !target) return true;
  if (relationType === "shared-path") {
    return pathsSharePrefix(source.paths, target.paths);
  }
  const sourceResources = concreteResources(source.resources);
  const targetResources = concreteResources(target.resources);
  if (sourceResources.size === 0 || targetResources.size === 0) return false;
  return [...sourceResources].some((resource) => targetResources.has(resource));
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

function listProjects(cwd = process.cwd(), options = {}) {
  const registry = readJson(REGISTRY_PATH, { version: 1, projects: {} });
  const registered = listRegisteredProjects();
  const byId = new Map();

  for (const project of registered) {
    const projectRoot = normalizeRoot(project.root);
    byId.set(project.id, {
      id: project.id,
      name: project.name,
      root: projectRoot,
      registeredAt: project.registeredAt,
      updatedAt: project.updatedAt,
      packs: project.packs || [],
      hasFxmind: fs.existsSync(path.join(projectRoot, ".fxmind")),
      hasRootPng: Boolean(rootPngPath(projectRoot)),
      source: "registry",
      local: false,
    });
  }

  const localRoot = options.exact ? normalizeRoot(cwd) : findProjectRoot(cwd);
  const localId = projectIdForRoot(localRoot);
  const localName = path.basename(localRoot) || "project";
  const existing = byId.get(localId);
  byId.set(localId, {
    id: localId,
    name: existing?.name || localName,
    root: localRoot,
    registeredAt: existing?.registeredAt,
    updatedAt: existing?.updatedAt,
    packs: existing?.packs || [],
    hasFxmind: fs.existsSync(path.join(localRoot, ".fxmind")),
    hasRootPng: Boolean(rootPngPath(localRoot)),
    source: "local",
    local: true,
  });

  const projects = [...byId.values()].sort((a, b) => {
    if (a.local && !b.local) return -1;
    if (!a.local && b.local) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    registryVersion: registry.version ?? 1,
    workspaceRoot: localRoot,
    workspaceId: localId,
    projects,
  };
}

function resolveProjectRoot(projectId, cwd = process.cwd(), options = {}) {
  if (!projectId) {
    return { ok: false, status: 400, error: "project id required" };
  }

  const { projects } = listProjects(cwd, options);
  let match = projects.find((p) => p.id === projectId);
  if (!match && !options.exact) {
    match = listProjects(cwd, { exact: true }).projects.find((p) => p.id === projectId);
  }
  if (!match) {
    return { ok: false, status: 404, error: "project not found" };
  }

  const root = path.resolve(match.root);
  if (!fs.existsSync(root)) {
    return { ok: false, status: 404, error: "project root missing on disk" };
  }
  try {
    if (!fs.statSync(root).isDirectory()) {
      return { ok: false, status: 400, error: "project root is not a directory" };
    }
  } catch {
    return { ok: false, status: 404, error: "project root missing on disk" };
  }

  return { ok: true, root, project: match };
}

/**
 * Select a project from the global registry without walking up to a parent
 * `.fxmind` directory. The folder picker and registry both represent an
 * explicit repository choice, including repositories that are not installed.
 */
function selectProjectRoot(projectId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;
  const root = normalizeRoot(resolved.root);
  pushRecentRoot(root);
  return {
    ok: true,
    root,
    project: { ...resolved.project, root },
  };
}

function getHealth() {
  return {
    ok: true,
    service: "fxmind-panel",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    features: {
      subagents: true,
      taskMode: true,
    },
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

function getGitBranch(root) {
  try {
    const branch = execFileSync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    ).trim();
    return branch || null;
  } catch {
    return null;
  }
}

function pushRecentRoot(root) {
  const config = readPanelConfig();
  const normalized = normalizeRoot(root);
  const prev = Array.isArray(config.recentRoots) ? config.recentRoots : [];
  const next = [normalized, ...prev.filter((r) => r !== normalized)].slice(0, 8);
  config.recentRoots = next;
  writePanelConfig(config);
  return next;
}

function getRecentRoots() {
  const config = readPanelConfig();
  return (config.recentRoots || []).filter((r) => fs.existsSync(r));
}

function browseFolderDialog() {
  if (process.platform === "win32") {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.Description = 'Selecione a pasta do projeto'",
      "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
    ].join("; ");
    try {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", ps],
        { encoding: "utf8", timeout: 120_000, windowsHide: false },
      ).trim();
      return out || null;
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "Selecione a pasta do projeto")'],
        { encoding: "utf8", timeout: 120_000 },
      ).trim();
      return out || null;
    } catch {
      return null;
    }
  }
  try {
    execFileSync("which", ["zenity"], { encoding: "utf8" });
    const out = execFileSync(
      "zenity",
      ["--file-selection", "--directory", "--title=Selecione a pasta do projeto"],
      { encoding: "utf8", timeout: 120_000 },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function bindWorkspaceRoot(root, options = {}) {
  const resolved = options.exact ? normalizeRoot(root) : findProjectRoot(root);
  if (!fs.existsSync(resolved)) {
    throw new Error("workspace folder missing on disk");
  }
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error("workspace path is not a directory");
    }
  } catch (err) {
    throw new Error(String(err.message || "workspace path is not a directory"));
  }
  pushRecentRoot(resolved);
  return resolved;
}

function getWorkspaceInfo(cwd = process.cwd(), options = {}) {
  const listed = listProjects(cwd, options);
  return {
    ...listed,
    gitBranch: getGitBranch(listed.workspaceRoot),
    recentRoots: getRecentRoots(),
    memoryCount: (() => {
      try {
        return tools.listMemories(listed.workspaceRoot).length;
      } catch {
        return 0;
      }
    })(),
    hasFxmind: fs.existsSync(path.join(listed.workspaceRoot, ".fxmind")),
  };
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

function getProjectMemories(projectId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;
  return { ok: true, memories: tools.listMemories(resolved.root) };
}

function validateProjectMemories(projectId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;
  return { ok: true, ...tools.validateMemories(resolved.root) };
}

function queryProject(projectId, body = {}, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
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

function getProjectGates(projectId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;
  return { ok: true, gates: tools.gateStatus(resolved.root) };
}

function getProjectGraph(projectId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;
  const graphPath = resolveInDataRoot(resolveDataRoot(resolved.root), "graphJson");
  if (!graphPath || !fs.existsSync(graphPath)) {
    return { ok: false, status: 404, error: "knowledge graph not found" };
  }
  try {
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    if (!graph || typeof graph !== "object") {
      return { ok: false, status: 500, error: "invalid knowledge graph" };
    }
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const rawLinks = Array.isArray(graph.links)
      ? graph.links
      : Array.isArray(graph.edges)
        ? graph.edges
        : [];
    const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
    const links = rawLinks.filter((link) => isConfirmedGraphLink(link, nodesById));
    const meta = graph.meta && typeof graph.meta === "object" ? { ...graph.meta } : {};
    if (meta.counts && typeof meta.counts === "object") {
      meta.counts = { ...meta.counts, links: links.length };
    }
    return {
      ok: true,
      nodes,
      links,
      meta,
    };
  } catch {
    return { ok: false, status: 500, error: "invalid knowledge graph" };
  }
}

function getProjectIcon(projectId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;
  const filePath = rootPngPath(resolved.root);
  if (!filePath) {
    return { ok: false, status: 404, error: "project root png not found" };
  }
  try {
    return { ok: true, contentType: "image/png", data: fs.readFileSync(filePath) };
  } catch {
    return { ok: false, status: 404, error: "project root png is unavailable" };
  }
}

function getProjectCorrections(projectId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;
  return { ok: true, corrections: tools.listCorrections(resolved.root) };
}

function getProjectMemoryContent(projectId, slug, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;

  const safe = String(slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (!safe) {
    return { ok: false, status: 400, error: "invalid slug" };
  }

  const abs = path.join(tools.memoryDir(resolved.root), `${safe}.md`);
  if (!fs.existsSync(abs)) {
    return { ok: false, status: 404, error: "memory not found" };
  }

  return { ok: true, slug: safe, content: fs.readFileSync(abs, "utf8") };
}

function addProjectCorrection(projectId, body = {}, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;

  try {
    const result = tools.recordCorrection(resolved.root, body);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, status: 400, error: String(err.message || err) };
  }
}

function editorBinCandidates() {
  const localApp = process.env.LOCALAPPDATA || "";
  const paths = [];
  if (process.platform === "win32") {
    paths.push(
      path.join(localApp, "Programs", "cursor", "Cursor.exe"),
      path.join(localApp, "Programs", "Microsoft VS Code", "Code.exe"),
    );
  } else if (process.platform === "darwin") {
    paths.push(
      "/Applications/Cursor.app/Contents/MacOS/Cursor",
      "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    );
  } else {
    paths.push("/usr/bin/cursor", "/usr/bin/code");
  }
  for (const name of ["cursor", "code"]) {
    try {
      if (process.platform === "win32") {
        const out = execFileSync("cmd.exe", ["/d", "/s", "/c", "where", name], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 4000,
        }).trim();
        const line = out.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
        if (line) paths.push(line);
      } else {
        const which = execFileSync("which", [name], { encoding: "utf8", timeout: 4000 }).trim();
        if (which) paths.push(which);
      }
    } catch {
      /* not on PATH */
    }
  }
  return [...new Set(paths.filter((item) => item && fs.existsSync(item)))];
}

function spawnDetached(bin, args) {
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  child.unref();
}

function openWithProtocol(absPath, line) {
  const posix = String(absPath).replace(/\\/g, "/");
  const uri = `cursor://file/${posix}:${line}`;
  if (process.platform === "win32") {
    spawnDetached("cmd.exe", ["/d", "/s", "/c", "start", "", uri]);
    return true;
  }
  if (process.platform === "darwin") {
    spawnDetached("open", [uri]);
    return true;
  }
  spawnDetached("xdg-open", [uri]);
  return true;
}

function openProjectFile(projectId, relPath, line, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;

  const rel = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    return { ok: false, status: 400, error: "invalid path" };
  }

  const abs = path.resolve(resolved.root, rel);
  const relative = path.relative(path.resolve(resolved.root), abs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, status: 400, error: "path outside project" };
  }
  if (!fs.existsSync(abs)) {
    return { ok: false, status: 404, error: "file not found" };
  }

  const goto = `${abs}:${lineNum}`;
  try {
    openWithProtocol(abs, lineNum);
  } catch {
    /* CLI fallback below */
  }
  for (const bin of editorBinCandidates()) {
    try {
      spawnDetached(bin, ["--goto", goto]);
      return { ok: true, path: abs, line: lineNum };
    } catch {
      /* try next */
    }
  }
  return { ok: true, path: abs, line: lineNum, via: "protocol" };
}

function promoteProjectCorrection(projectId, correctionId, cwd = process.cwd(), options = {}) {
  const resolved = resolveProjectRoot(projectId, cwd, options);
  if (!resolved.ok) return resolved;

  try {
    const result = tools.promoteCorrection(resolved.root, correctionId);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, status: 400, error: String(err.message || err) };
  }
}

module.exports = {
  panelConfigPath,
  readPanelConfig,
  writePanelConfig,
  keyPrefix,
  normalizeRoot,
  findProjectRoot,
  listProjects,
  resolveProjectRoot,
  getHealth,
  getPortspaceSettings,
  putPortspaceSettings,
  fetchPortspaceInbox,
  getProjectMemories,
  validateProjectMemories,
  queryProject,
  getProjectGates,
  getProjectGraph,
  getProjectIcon,
  getProjectCorrections,
  getProjectMemoryContent,
  addProjectCorrection,
  openProjectFile,
  promoteProjectCorrection,
  getGitBranch,
  pushRecentRoot,
  getRecentRoots,
  browseFolderDialog,
  bindWorkspaceRoot,
  selectProjectRoot,
  getWorkspaceInfo,
  rootPngPath,
};
