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

const SHARED_DIR = ".fxmind";
const GENERIC_TOPIC_TOKENS = new Set([
  "config", "script", "module", "system", "core", "main", "utils", "util",
  "handler", "server", "client", "shared", "resource", "data", "file", "files",
  "event", "events", "export", "exports", "function", "local", "return",
  "fivem", "lua", "json", "md", "src", "lib", "api", "type", "types",
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

  for (const line of body.split(/\r?\n/)) {
    const arrayMatch = line.match(/^([a-zA-Z0-9_]+):\s*\[(.*)\]\s*$/);
    if (arrayMatch) {
      const items = arrayMatch[2]
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      meta[arrayMatch[1]] = items;
      continue;
    }

    const scalarMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.+?)\s*$/);
    if (scalarMatch) {
      meta[scalarMatch[1]] = scalarMatch[2].replace(/^["']|["']$/g, "");
    }
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
      paths.add(value);
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
  const match = String(value).match(/resources[/\\]([^/\\]+)/i);
  return match ? match[1].toLowerCase() : null;
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
    _resources: resources,
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

  for (let i = 0; i < learnedNodes.length; i += 1) {
    for (let j = i + 1; j < learnedNodes.length; j += 1) {
      const a = learnedNodes[i];
      const b = learnedNodes[j];

      const sharedEvents = a._events.filter((event) => b._events.includes(event));
      if (sharedEvents.length > 0) {
        addLink(links, seen, a.id, b.id, "event-flow", "extracted");
        continue;
      }

      const sharedResources = a._resources.filter((r) => b._resources.includes(r));
      if (sharedResources.length > 0) {
        addLink(links, seen, a.id, b.id, "shared-resource", "extracted");
        continue;
      }

      const sharedPaths = a._paths.filter((p) => b._paths.some((bp) => bp === p || bp.includes(p) || p.includes(bp)));
      if (sharedPaths.length > 0) {
        addLink(links, seen, a.id, b.id, "shared-path", "extracted");
        continue;
      }

      const sharedSymbols = [
        ...a._exports,
        ...a._symbols,
        ...b._exports,
        ...b._symbols,
      ];
      const aSymbols = new Set([...a._exports, ...a._symbols]);
      const symbolHit = b._exports.some((s) => aSymbols.has(s)) ||
        b._symbols.some((s) => aSymbols.has(s));
      if (symbolHit && sharedSymbols.length > 0) {
        addLink(links, seen, a.id, b.id, "shared-symbol", "inferred");
        continue;
      }

      const mentionPattern = new RegExp(`\\b${a.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const reversePattern = new RegExp(`\\b${b.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (mentionPattern.test(b._content) || reversePattern.test(a._content)) {
        addLink(links, seen, a.id, b.id, "cross-mention", "inferred");
        continue;
      }

      const aTokens = tokenizeTechnical(`${a.triggers} ${a._content} ${a.paths}`);
      const bTokens = tokenizeTechnical(`${b.triggers} ${b._content} ${b.paths}`);
      let shared = 0;
      for (const token of aTokens) {
        if (bTokens.has(token)) {
          shared += 1;
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
  const localHtml = path.join(targetRoot, SHARED_DIR, "knowledge-graph.html");
  const dataRoot = resolveDataRoot(targetRoot);
  const globalHtml = path.join(dataRoot, "knowledge-graph.html");

  if (!syncKnowledgeGraphHtmlAt(localHtml, graphData) && !syncKnowledgeGraphHtmlAt(globalHtml, graphData)) {
    throw new Error(
      `Missing ${SHARED_DIR}/knowledge-graph.html — run fxmind -y first.`,
    );
  }
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

function buildGraphData(projectRoot) {
  const projectRootResolved = path.resolve(projectRoot);
  const localFxmindDir = path.join(projectRootResolved, SHARED_DIR);
  const memoryDir = resolveMemoryDir(projectRootResolved);

  if (!fs.existsSync(localFxmindDir)) {
    throw new Error(
      `Missing ${SHARED_DIR}/ — run fxmind -y from the project root first.`,
    );
  }

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
      const content = fs.readFileSync(path.join(memoryDir, entry.name), "utf8");
      learnedNodes.push(
        buildLearnedNode(slug, content, indexRows.get(slug), projectRootResolved),
      );
    }
  }

  learnedNodes.sort((a, b) => a.id.localeCompare(b.id));

  const catalogPath = path.join(localFxmindDir, "topic-catalog.md");
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

function writeGraph(projectRoot, graphData) {
  const dataRoot = resolveDataRoot(projectRoot);
  const jsonPath = path.join(dataRoot, "knowledge-graph.json");
  const localHtml = path.join(projectRoot, SHARED_DIR, "knowledge-graph.html");

  fs.writeFileSync(jsonPath, `${JSON.stringify(graphData, null, 2)}\n`, "utf8");
  syncKnowledgeGraphHtml(projectRoot, graphData);

  let memoryIndex = null;
  try {
    const { writeMemoryIndex } = require("./fxmind-tools");
    memoryIndex = writeMemoryIndex(projectRoot);
  } catch {
    // optional — fxmind-tools may not be available in odd load orders
  }

  return {
    jsonPath: path.relative(projectRoot, jsonPath),
    htmlPath: path.relative(projectRoot, localHtml),
    absoluteHtmlPath: fs.existsSync(localHtml) ? localHtml : path.join(dataRoot, "knowledge-graph.html"),
    memoryIndex,
  };
}

function printGraphHelp() {
  console.log(`
Build the 3D knowledge graph from .fxmind/memory/ and open it in the browser.

Usage:
  fxmind graph [options]
  npx --yes github:fx-mind/fxmind graph

Options:
  --target <dir>   Project root (default: current directory)
  --no-open        Write JSON/HTML only — do not open the browser
  -h, --help       Show this help

Reads:
  .fxmind/memory/_index.md
  .fxmind/memory/*.md
  .fxmind/topic-catalog.md

Writes:
  .fxmind/knowledge-graph.json
  .fxmind/knowledge-graph.html
  .fxmind/memory-index.json
`);
}

function parseGraphCliArgs(argv) {
  const options = {
    target: process.cwd(),
    open: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--no-open") {
      options.open = false;
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
    const graphData = buildGraphData(options.target);
    const paths = writeGraph(options.target, graphData);

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
};

if (require.main === module) {
  process.exit(runGraphCli(process.argv.slice(2)));
}
