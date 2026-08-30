#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  resolveDataRoot,
  resolveMemoryDir,
  readStore,
  loadForeignMemories,
  projectIdForRoot,
} = require("./global-store");
const {
  SHARED_DIR,
  REL,
  resolveLocal,
  writeLocal,
  resolveInDataRoot,
  writeInDataRoot,
  ensureDirFor,
} = require("./lib/layout");
const GRAPH_CACHE_SCHEMA = 2;
const GRAPH_CACHE_FILE = REL.graphCache;
const GENERIC_TOPIC_TOKENS = new Set([
  "config", "script", "module", "system", "core", "main", "utils", "util",
  "handler", "server", "client", "shared", "resource", "data", "file", "files",
  "event", "events", "export", "exports", "function", "local", "return",
  "fivem", "lua", "json", "md", "src", "lib", "api", "type", "types",
]);
const GENERIC_RESOURCE_SEGMENTS = new Set([
  "build", "client", "client-side", "config", "configs", "dist", "server",
  "server-side", "shared", "shared-side", "src", "ui", "web",
]);
const GENERIC_EVENT_NAMESPACES = new Set([
  "client", "core", "event", "events", "fivem", "main", "player", "resource",
  "server", "shared", "system",
]);
const PATH_EXTENSIONS = new Set([
  ".cfg", ".css", ".html", ".js", ".json", ".lua", ".md", ".sql", ".ts",
  ".tsx", ".vue",
]);

const PLURAL_MAP = [
  ["permissions", "permission"],
  ["grupos", "grupo"],
  ["items", "item"],
  ["itens", "item"],
  ["veiculos", "veiculo"],
  ["vehicles", "vehicle"],
  ["lojas", "loja"],
  ["shops", "shop"],
];

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function singularizeToken(token) {
  let value = token;
  for (const [plural, singular] of PLURAL_MAP) {
    if (value === plural) {
      return singular;
    }
  }
  if (value.endsWith("s") && value.length > 4) {
    return value.slice(0, -1);
  }
  return value;
}

function canonicalTopicKey(value) {
  const raw = stripAccents(String(value || "").toLowerCase())
    .replace(/[`"'()[\]{}]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularizeToken)
    .filter((token) => token.length >= 2 && !GENERIC_TOPIC_TOKENS.has(token));

  return raw.length ? raw.join("-") : "";
}

function collectTopicKeys(node) {
  const keys = new Set();
  for (const field of [node.id, node.name, node.triggers, node.searchHints]) {
    const canonical = canonicalTopicKey(field);
    if (canonical) {
      keys.add(canonical);
    }
    stripAccents(String(field || "").toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !GENERIC_TOPIC_TOKENS.has(token))
      .map(singularizeToken)
      .forEach((token) => keys.add(token));
  }
  return keys;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }

  const meta = {};
  const body = match[1];
  let listKey = null;

  for (const line of body.split(/\r?\n/)) {
    const listItemMatch = line.match(/^\s*-\s*(.*?)\s*$/);
    if (listItemMatch && listKey) {
      const value = listItemMatch[1].replace(/^["']|["']$/g, "");
      if (value) meta[listKey].push(value);
      continue;
    }

    const arrayMatch = line.match(/^([a-zA-Z0-9_]+):\s*\[(.*)\]\s*$/);
    if (arrayMatch) {
      const items = arrayMatch[2]
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      meta[arrayMatch[1]] = items;
      listKey = null;
      continue;
    }

    const listKeyMatch = line.match(/^([a-zA-Z0-9_]+):\s*$/);
    if (listKeyMatch) {
      listKey = listKeyMatch[1];
      meta[listKey] = [];
      continue;
    }

    const scalarMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.+?)\s*$/);
    if (scalarMatch) {
      meta[scalarMatch[1]] = scalarMatch[2].replace(/^["']|["']$/g, "");
      listKey = null;
      continue;
    }

    if (line.trim()) listKey = null;
  }

  return meta;
}

function parseIndexRows(content) {
  const rows = new Map();

  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith("|") || line.includes("Topic |") || line.includes("---")) {
      continue;
    }

    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length < 4 || cells[0].startsWith("_(")) {
      continue;
    }

    rows.set(cells[0].toLowerCase(), {
      topic: cells[0],
      file: cells[1],
      triggers: cells[2],
      updated: cells[3],
    });
  }

  return rows;
}

function parseTopicCatalog(content) {
  const rows = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith("|") || line.includes("Tópico |") || line.includes("---")) {
      continue;
    }

    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length < 3 || cells[0].startsWith("Exemplos")) {
      continue;
    }

    const slugMatch = cells[0].match(/`([^`]+)`/);
    if (!slugMatch) {
      continue;
    }

    rows.push({
      id: slugMatch[1].toLowerCase(),
      name: slugMatch[1],
      triggers: cells[1],
      searchHints: cells[2],
    });
  }

  return rows;
}

function extractBacktickPaths(content) {
  const paths = new Set();
  const pattern = /`([^`]+)`/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const value = match[1].trim();
    if (
      value.includes("/") ||
      value.includes("\\") ||
      value.endsWith(".lua") ||
      value.endsWith(".md") ||
      value.includes("config.")
    ) {
      if (isConcretePath(value)) paths.add(value);
    }
  }

  return [...paths];
}

function extractQuotedEvents(content) {
  const events = new Set();
  const patterns = [
    /['"]([a-zA-Z0-9:_-]+:[a-zA-Z0-9:_-]+)['"]/g,
    /RegisterNetEvent\s*\(\s*['"]([^'"]+)['"]/g,
    /TriggerServerEvent\s*\(\s*['"]([^'"]+)['"]/g,
    /TriggerClientEvent\s*\(\s*['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) {
        events.add(match[1]);
      }
    }
  }

  return [...events];
}

function resourceFromPath(value) {
  const segments = String(value)
    .split(/[/\\]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const resourcesIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "resources",
  );
  if (resourcesIndex < 0) return null;

  for (const rawSegment of segments.slice(resourcesIndex + 1)) {
    const segment = rawSegment.replace(/[.,;:]+$/, "");
    if (
      !segment ||
      /^\[.*\]$/.test(segment) ||
      GENERIC_RESOURCE_SEGMENTS.has(segment.toLowerCase()) ||
      path.extname(segment)
    ) {
      continue;
    }
    return segment.toLowerCase();
  }
  return null;
}

function isConcretePath(value) {
  const candidate = String(value || "").trim().replace(/^["'`]|["'`]$/g, "");
  if (
    !candidate ||
    candidate.length > 240 ||
    candidate.startsWith("/") ||
    /[\r\n—*]/.test(candidate) ||
    /\s/.test(candidate)
  ) {
    return false;
  }
  const lower = candidate.toLowerCase();
  return (
    lower.includes("/") ||
    lower.includes("\\") ||
    [...PATH_EXTENSIONS].some((extension) => lower.endsWith(extension))
  );
}

function isLinkablePath(value) {
  const candidate = String(value || "").trim().replace(/^["'`]|["'`]$/g, "");
  return (
    isConcretePath(candidate) &&
    /^(?:resources|\.fxmind)[/\\]/i.test(candidate)
  );
}

function isConcreteResource(value) {
  const resource = String(value || "").trim();
  return Boolean(resource) && !/^\[[^\]]+\]$/.test(resource);
}

function normalizeArrayField(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function buildLearnedNode(slug, content, indexRow, projectRoot) {
  const meta = parseFrontmatter(content);
  const body = content.replace(/^---[\s\S]*?---\r?\n?/, "");
  const filePath = path.join(SHARED_DIR, "memory", `${slug}.md`).replace(/\\/g, "/");

  const paths =
    normalizeArrayField(meta.paths).length > 0
      ? normalizeArrayField(meta.paths)
      : extractBacktickPaths(body);

  const events =
    normalizeArrayField(meta.events).length > 0
      ? normalizeArrayField(meta.events)
      : extractQuotedEvents(body);

  const resources = normalizeArrayField(meta.resources);
  for (const p of paths) {
    const resource = resourceFromPath(p);
    if (resource && !resources.includes(resource)) {
      resources.push(resource);
    }
  }

  return {
    id: slug,
    name: meta.topic || indexRow?.topic || slug,
    group: "learned",
    file: filePath,
    updated: meta.updated || indexRow?.updated || "",
    framework: meta.framework || "",
    triggers:
      normalizeArrayField(meta.triggers).join(", ") ||
      indexRow?.triggers ||
      "",
    events: events.join(", "),
    exports: normalizeArrayField(meta.exports).join(", "),
    resources: resources.join(", "),
    tokens: Math.round(content.length / 4),
    paths: paths.join(", "),
    searchHints: "",
    _content: body,
    _paths: paths,
    _events: events,
    _resources: resources.filter(isConcreteResource),
    _exports: normalizeArrayField(meta.exports),
    _symbols: normalizeArrayField(meta.symbols),
    _triggers: normalizeArrayField(meta.triggers),
  };
}

function catalogMatchesLearned(catalogRow, learnedNodes) {
  const catalogKeys = collectTopicKeys({
    id: catalogRow.id,
    name: catalogRow.name,
    triggers: catalogRow.triggers,
    searchHints: catalogRow.searchHints,
  });

  for (const node of learnedNodes) {
    const learnedKeys = collectTopicKeys(node);
    for (const key of catalogKeys) {
      if (learnedKeys.has(key)) {
        return true;
      }
    }
    if (learnedKeys.has(catalogRow.id) || learnedKeys.has(canonicalTopicKey(catalogRow.id))) {
      return true;
    }
  }

  return false;
}

function buildCatalogNodes(catalogRows, learnedNodes) {
  return catalogRows
    .filter((row) => !catalogMatchesLearned(row, learnedNodes))
    .map((row) => {
      const paths = extractBacktickPaths(row.searchHints);
      const hintText = `${row.triggers} ${row.searchHints}`.trim();
      return {
        id: row.id,
        name: row.name,
        group: "catalog",
        file: "",
        updated: "",
        framework: "",
        triggers: row.triggers,
        events: "",
        exports: "",
        resources: "",
        tokens: Math.round(hintText.length / 4),
        paths: paths.join(", "),
        searchHints: row.searchHints,
        _paths: paths,
        _events: [],
        _resources: [],
        _exports: [],
        _symbols: [],
        _triggers: row.triggers.split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
        _content: "",
      };
    });
}

function linkKey(source, target, type) {
  return `${source}|${target}|${type}`;
}

function addLink(links, seen, source, target, type, confidence) {
  if (source === target) {
    return;
  }
  const key = linkKey(source, target, type);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  links.push({ source, target, type, confidence });
}

function tokenizeTechnical(text) {
  return new Set(
    stripAccents(String(text || "").toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !GENERIC_TOPIC_TOKENS.has(token))
      .map(singularizeToken),
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pairKey(aId, bId) {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function eventNamespace(value) {
  const raw = String(value || "").trim().toLowerCase();
  const separator = raw.indexOf(":");
  if (separator < 3) return null;
  const namespace = raw.slice(0, separator);
  if (
    !/^[a-z0-9_-]+$/.test(namespace) ||
    GENERIC_EVENT_NAMESPACES.has(namespace)
  ) {
    return null;
  }
  return namespace;
}

function sharedEventNamespaces(aEvents, bEvents) {
  const aNamespaces = new Set(
    normalizeArrayField(aEvents).map(eventNamespace).filter(Boolean),
  );
  return [
    ...new Set(
      normalizeArrayField(bEvents)
        .map(eventNamespace)
        .filter((namespace) => namespace && aNamespaces.has(namespace)),
    ),
  ];
}

function buildMentionPairs(learnedNodes) {
  const pairs = new Set();
  for (const a of learnedNodes) {
    for (const b of learnedNodes) {
      if (a.id === b.id) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(b.id)}\\b`, "i");
      if (pattern.test(a._content)) {
        pairs.add(pairKey(a.id, b.id));
      }
    }
  }
  return pairs;
}

function pathsOverlap(aPaths, bPaths) {
  for (const p of aPaths.filter(isLinkablePath)) {
    for (const bp of bPaths.filter(isLinkablePath)) {
      if (bp === p || bp.includes(p) || p.includes(bp)) {
        return true;
      }
    }
  }
  return false;
}

function inferLinks(learnedNodes) {
  const links = [];
  const seen = new Set();
  const priority = [
    "event-flow",
    "shared-resource",
    "shared-path",
    "shared-symbol",
    "cross-mention",
    "domain-related",
  ];

  const mentionPairs = buildMentionPairs(learnedNodes);
  const contentTokensById = new Map();
  for (const node of learnedNodes) {
    contentTokensById.set(
      node.id,
      tokenizeTechnical(`${node.triggers} ${node._content} ${node.paths}`),
    );
  }

  for (let i = 0; i < learnedNodes.length; i += 1) {
    for (let j = i + 1; j < learnedNodes.length; j += 1) {
      const a = learnedNodes[i];
      const b = learnedNodes[j];

      const bEvents = new Set(b._events);
      if (a._events.some((event) => bEvents.has(event))) {
        addLink(links, seen, a.id, b.id, "event-flow", "extracted");
        continue;
      }

      const bResources = new Set(b._resources.filter(isConcreteResource));
      if (a._resources.filter(isConcreteResource).some((r) => bResources.has(r))) {
        addLink(links, seen, a.id, b.id, "shared-resource", "extracted");
        continue;
      }

      if (pathsOverlap(a._paths, b._paths)) {
        addLink(links, seen, a.id, b.id, "shared-path", "extracted");
        continue;
      }

      if (sharedEventNamespaces(a._events, b._events).length > 0) {
        addLink(links, seen, a.id, b.id, "event-domain", "inferred");
        continue;
      }

      const aSymbols = new Set([...a._exports, ...a._symbols]);
      const symbolHit =
        b._exports.some((s) => aSymbols.has(s)) ||
        b._symbols.some((s) => aSymbols.has(s));
      if (symbolHit) {
        addLink(links, seen, a.id, b.id, "shared-symbol", "inferred");
        continue;
      }

      if (mentionPairs.has(pairKey(a.id, b.id))) {
        addLink(links, seen, a.id, b.id, "cross-mention", "inferred");
        continue;
      }

      const aTokens = contentTokensById.get(a.id);
      const bTokens = contentTokensById.get(b.id);
      let shared = 0;
      for (const token of aTokens) {
        if (bTokens.has(token)) {
          shared += 1;
          if (shared >= 2) break;
        }
      }
      if (shared >= 2) {
        addLink(links, seen, a.id, b.id, "domain-related", "inferred");
      }
    }
  }

  links.sort(
    (left, right) => priority.indexOf(left.type) - priority.indexOf(right.type),
  );

  return links;
}

function stripInternalFields(node) {
  const clean = { ...node };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("_")) {
      delete clean[key];
    }
  }
  return clean;
}

function syncKnowledgeGraphHtmlAt(htmlPath, graphData) {
  if (!fs.existsSync(htmlPath)) {
    return false;
  }

  const graphJsonStr = JSON.stringify(graphData, null, 2);
  let html = fs.readFileSync(htmlPath, "utf8");

  if (html.includes("/*__GRAPH_DATA__*/")) {
    html = html.replace("/*__GRAPH_DATA__*/", graphJsonStr);
  } else {
    html = html.replace(
      /const GRAPH_DATA = [\s\S]*?;\s*\n/,
      `const GRAPH_DATA = ${graphJsonStr};\n`,
    );
  }

  fs.writeFileSync(htmlPath, html, "utf8");
  return true;
}

function syncKnowledgeGraphHtml(targetRoot, graphData) {
  const localHtml = resolveLocal(targetRoot, "graphHtml");
  const dataRoot = resolveDataRoot(targetRoot);
  const globalHtml = resolveInDataRoot(dataRoot, "graphHtml");

  if (!syncKnowledgeGraphHtmlAt(localHtml, graphData) && !syncKnowledgeGraphHtmlAt(globalHtml, graphData)) {
    return false;
  }
  return true;
}

function openGraphInBrowser(htmlPath) {
  const absPath = path.resolve(htmlPath);
  const platform = process.platform;

  if (platform === "win32") {
    execFileSync("cmd", ["/c", "start", "", absPath], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  if (platform === "darwin") {
    execFileSync("open", [absPath], { stdio: "ignore" });
    return;
  }

  execFileSync("xdg-open", [absPath], { stdio: "ignore" });
}

function inferCrossProjectLinks(localNodes, foreignNodes) {
  const links = [];
  const seen = new Set();

  for (const local of localNodes) {
    for (const foreign of foreignNodes) {
      const foreignSlug = foreign.id.includes(":")
        ? foreign.id.split(":").slice(1).join(":")
        : foreign.id;

      if (
        local.id === foreignSlug ||
        canonicalTopicKey(local.id) === canonicalTopicKey(foreignSlug) ||
        canonicalTopicKey(local.name) === canonicalTopicKey(foreign.name)
      ) {
        addLink(links, seen, local.id, foreign.id, "cross-project", "inferred");
        continue;
      }

      const sharedEvents = local._events.filter((event) => foreign._events.includes(event));
      if (sharedEvents.length > 0) {
        addLink(links, seen, local.id, foreign.id, "cross-project", "extracted");
        continue;
      }

      const sharedResources = local._resources.filter((r) => foreign._resources.includes(r));
      if (sharedResources.length > 0) {
        addLink(links, seen, local.id, foreign.id, "cross-project", "inferred");
        continue;
      }

      const localKeys = collectTopicKeys(local);
      const foreignKeys = collectTopicKeys(foreign);
      for (const key of localKeys) {
        if (foreignKeys.has(key)) {
          addLink(links, seen, local.id, foreign.id, "cross-project", "inferred");
          break;
        }
      }
    }
  }

  return links;
}

function extractMemoryBody(content) {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1] : content;
}

function loadGraphCache(projectRoot) {
  const cachePath = resolveLocal(projectRoot, "graphCache");
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (parsed?.schemaVersion !== GRAPH_CACHE_SCHEMA || !parsed.files) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveGraphCache(projectRoot, files) {
  const cachePath = writeLocal(projectRoot, "graphCache");
  ensureDirFor(cachePath);
  fs.writeFileSync(
    cachePath,
    `${JSON.stringify({ schemaVersion: GRAPH_CACHE_SCHEMA, files }, null, 2)}\n`,
    "utf8",
  );
}

function nodeForCache(node) {
  const copy = { ...node };
  delete copy._content;
  return copy;
}

function buildGraphData(projectRoot, options = {}) {
  const projectRootResolved = path.resolve(projectRoot);
  const localFxmindDir = path.join(projectRootResolved, SHARED_DIR);
  const memoryDir = resolveMemoryDir(projectRootResolved);
  const dataRoot = resolveDataRoot(projectRootResolved);
  const useCache = options.useCache === true;

  if (!fs.existsSync(localFxmindDir)) {
    throw new Error(
      `Missing ${SHARED_DIR}/ — run fxmind -y from the project root first.`,
    );
  }

  const cache = useCache ? loadGraphCache(projectRootResolved) : null;
  const cacheFiles = cache?.files || {};
  const nextCacheFiles = {};

  const indexPath = path.join(memoryDir, "_index.md");
  const indexRows = fs.existsSync(indexPath)
    ? parseIndexRows(fs.readFileSync(indexPath, "utf8"))
    : new Map();

  const learnedNodes = [];
  if (fs.existsSync(memoryDir)) {
    for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "_index.md") {
        continue;
      }

      const slug = entry.name.replace(/\.md$/i, "").toLowerCase();
      const filePath = path.join(memoryDir, entry.name);
      const mtimeMs = fs.statSync(filePath).mtimeMs;
      const cached = cacheFiles[slug];

      if (
        cached &&
        cached.mtimeMs === mtimeMs &&
        cached.node &&
        typeof cached.node === "object"
      ) {
        const content = fs.readFileSync(filePath, "utf8");
        learnedNodes.push({
          ...cached.node,
          _content: extractMemoryBody(content),
        });
        nextCacheFiles[slug] = { mtimeMs, node: cached.node };
        continue;
      }

      const content = fs.readFileSync(filePath, "utf8");
      const node = buildLearnedNode(slug, content, indexRows.get(slug), projectRootResolved);
      learnedNodes.push(node);
      nextCacheFiles[slug] = { mtimeMs, node: nodeForCache(node) };
    }
  }

  if (useCache) {
    saveGraphCache(projectRootResolved, nextCacheFiles);
  }

  learnedNodes.sort((a, b) => a.id.localeCompare(b.id));

  const catalogPath = resolveLocal(projectRootResolved, "topicCatalog");
  const catalogRows = fs.existsSync(catalogPath)
    ? parseTopicCatalog(fs.readFileSync(catalogPath, "utf8"))
    : [];

  const catalogNodes = buildCatalogNodes(catalogRows, learnedNodes);
  const links = inferLinks(learnedNodes);

  const store = readStore(projectRootResolved);
  const currentProjectId = store?.projectId || projectIdForRoot(projectRootResolved);
  const foreignNodes = [];

  if (store?.mode === "global") {
    for (const foreign of loadForeignMemories(currentProjectId)) {
      const raw = buildLearnedNode(
        foreign.slug,
        foreign.content,
        null,
        foreign.projectRoot,
      );
      raw.id = `${foreign.projectId}:${foreign.slug}`;
      raw.name = `${foreign.projectName}/${raw.name}`;
      raw.group = "foreign";
      raw.projectId = foreign.projectId;
      raw.projectName = foreign.projectName;
      raw.projectRoot = foreign.projectRoot.replace(/\\/g, "/");
      raw.file = `.fxmind/memory/${foreign.slug}.md`;
      foreignNodes.push(raw);
    }
  }

  links.push(...inferCrossProjectLinks(learnedNodes, foreignNodes));

  const allNodes = [...learnedNodes, ...foreignNodes, ...catalogNodes].map(
    stripInternalFields,
  );

  const graphData = {
    nodes: allNodes,
    links,
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      agent: "shared",
      fxmindDir: SHARED_DIR,
      storage: store?.mode || "local",
      projectId: currentProjectId,
      counts: {
        learned: learnedNodes.length,
        catalog: catalogNodes.length,
        foreign: foreignNodes.length,
        links: links.length,
        tokens: allNodes.reduce((sum, node) => sum + (node.tokens || 0), 0),
      },
    },
  };

  return graphData;
}

function writeGraph(projectRoot, graphData, options = {}) {
  const updateHtml =
    options.updateHtml !== false || process.env.FXMIND_GRAPH_UPDATE_HTML === "1";

  const dataRoot = resolveDataRoot(projectRoot);
  const jsonPath = writeInDataRoot(dataRoot, "graphJson");
  const localHtml = writeLocal(projectRoot, "graphHtml");
  ensureDirFor(jsonPath);

  fs.writeFileSync(jsonPath, `${JSON.stringify(graphData, null, 2)}\n`, "utf8");
  if (updateHtml) {
    syncKnowledgeGraphHtml(projectRoot, graphData);
  }

  let memoryIndex = null;
  try {
    const { writeMemoryIndex } = require("./fxmind-tools");
    memoryIndex = writeMemoryIndex(projectRoot);
  } catch {
    // optional — fxmind-tools may not be available in odd load orders
  }

  const htmlExisting = resolveLocal(projectRoot, "graphHtml");
  const globalHtml = resolveInDataRoot(dataRoot, "graphHtml");

  return {
    jsonPath: path.relative(projectRoot, jsonPath),
    htmlPath: path.relative(projectRoot, localHtml),
    absoluteHtmlPath: fs.existsSync(htmlExisting)
      ? htmlExisting
      : fs.existsSync(globalHtml)
        ? globalHtml
        : localHtml,
    memoryIndex,
  };
}

function printGraphHelp() {
  console.log(`
Build the 2D knowledge graph from .fxmind/memory/ and open it in the browser.

Usage:
  fxmind graph [options]
  npx --yes github:fx-mind/fxmind graph

Options:
  --target <dir>   Project root (default: current directory)
  --no-open        Write JSON/HTML only — do not open the browser
  --no-html        Update knowledge-graph.json + memory-index only (skip HTML)
  -h, --help       Show this help

Reads:
  .fxmind/memory/_index.md
  .fxmind/memory/*.md
  .fxmind/policy/topic-catalog.md

Writes:
  .fxmind/graph/knowledge-graph.json
  .fxmind/graph/knowledge-graph.html (unless --no-html)
  .fxmind/graph/memory-index.json
`);
}

function parseGraphCliArgs(argv) {
  const options = {
    target: process.cwd(),
    open: true,
    help: false,
    updateHtml: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--no-open") {
      options.open = false;
    } else if (arg === "--no-html") {
      options.updateHtml = false;
    } else if (arg === "--target") {
      options.target = path.resolve(argv[i + 1] || "");
      i += 1;
    }
  }

  return options;
}

function runGraphCli(argv = process.argv.slice(3)) {
  const options = parseGraphCliArgs(argv);

  if (options.help) {
    printGraphHelp();
    return 0;
  }

  if (!fs.existsSync(options.target)) {
    console.error(`Error: target directory does not exist: ${options.target}`);
    return 1;
  }

  try {
    const graphData = buildGraphData(options.target, { useCache: true });
    const paths = writeGraph(options.target, graphData, { updateHtml: options.updateHtml });

    console.log(`\nGraph built: ${options.target}`);
    console.log(`  learned  → ${graphData.meta.counts.learned}`);
    console.log(`  catalog  → ${graphData.meta.counts.catalog}`);
    if (graphData.meta.counts.foreign) {
      console.log(`  foreign  → ${graphData.meta.counts.foreign} (other projects)`);
    }
    console.log(`  links    → ${graphData.meta.counts.links}`);
    console.log(`  tokens   → ~${graphData.meta.counts.tokens.toLocaleString("en-US")}`);
    console.log(`  json     → ${paths.jsonPath}`);
    console.log(`  html     → ${paths.htmlPath}`);
    if (paths.memoryIndex) {
      console.log(
        `  index    → ${paths.memoryIndex.path} (${paths.memoryIndex.count} memories)`,
      );
    }

    if (options.open) {
      openGraphInBrowser(paths.absoluteHtmlPath);
      console.log("  browser  → opened");
    }

    console.log("");
    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

module.exports = {
  buildGraphData,
  writeGraph,
  syncKnowledgeGraphHtml,
  openGraphInBrowser,
  runGraphCli,
  inferLinks,
  resourceFromPath,
  GRAPH_CACHE_SCHEMA,
  GRAPH_CACHE_FILE,
};

if (require.main === module) {
  process.exit(runGraphCli(process.argv.slice(2)));
}
