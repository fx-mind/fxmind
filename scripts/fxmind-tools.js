/**
 * fxmind-tools — reusable logic for the MCP server, the `fxmind hooks` CLI,
 * and external integrations. No external deps; pure Node.
 *
 * Operations:
 *  - listMemories        → memory index + frontmatter summary
 *  - driftCheck          → memories referencing a changed file path
 *  - buildGraph          → rebuild knowledge-graph.json + HTML (delegates to build-graph.js)
 *  - queryGraph          → BFS/DFS traversal over the graph, budget-aware memory load
 *  - gateStatus          → read Gate markers recorded by the Cursor gate-guard hook
 *  - recordGate          → persist Gate markers (used by hooks and `/fxmind task`)
 */

const fs = require("fs");
const path = require("path");

const { SHARED_DIR } = require("./global-store");
const { buildGraphData, writeGraph } = require("./build-graph");

const GATES_FILE = "fxmind-gates.json";
const GATES_REL = path.join(SHARED_DIR, GATES_FILE);
const LEGACY_GATES_REL = ".fxmind-gates.json";

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

function fxmindDir(targetRoot) {
  return path.join(path.resolve(targetRoot), SHARED_DIR);
}

function memoryDir(targetRoot) {
  return path.join(fxmindDir(targetRoot), "memory");
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
      meta[arrayMatch[1]] = arrayMatch[2]
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    const scalarMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.+?)\s*$/);
    if (scalarMatch) {
      meta[scalarMatch[1]] = scalarMatch[2].replace(/^["']|["']$/g, "");
    }
  }
  return meta;
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

function listMemories(targetRoot) {
  const dir = memoryDir(targetRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "_index.md") {
      continue;
    }
    const slug = entry.name.replace(/\.md$/i, "").toLowerCase();
    const content = fs.readFileSync(path.join(dir, entry.name), "utf8");
    const meta = parseFrontmatter(content);
    out.push({
      slug,
      file: path.join(SHARED_DIR, "memory", entry.name).replace(/\\/g, "/"),
      topic: meta.topic || slug,
      framework: meta.framework || "",
      updated: meta.updated || "",
      resources: normalizeArrayField(meta.resources),
      paths: normalizeArrayField(meta.paths),
      events: normalizeArrayField(meta.events),
      exports: normalizeArrayField(meta.exports),
      triggers: normalizeArrayField(meta.triggers),
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

function normalizeRepoPath(value, targetRoot) {
  let v = String(value).replace(/\\/g, "/").replace(/^\.\//, "");
  if (v.startsWith(`${SHARED_DIR}/`) || v.startsWith(".fxmind/")) {
    return v;
  }
  return v;
}

/**
 * Drift check: given a changed file (relative to project root, or absolute),
 * return memories whose frontmatter paths[] reference it AND the file no longer
 * exists (stale) — or the path still exists but the memory hasn't been updated
 * recently (candidate re-learn). Caller decides what to do.
 */
function driftCheck(targetRoot, changedFile) {
  const resolved = path.resolve(targetRoot, changedFile);
  const rel = path.relative(path.resolve(targetRoot), resolved).replace(/\\/g, "/");
  const fileExists = fs.existsSync(resolved);
  const memories = listMemories(targetRoot);
  const hits = [];

  for (const mem of memories) {
    for (const p of mem.paths) {
      const normP = normalizeRepoPath(p, targetRoot);
      const matches =
        normP === rel ||
        normP.endsWith(`/${rel}`) ||
        rel.endsWith(`/${normP}`) ||
        (normP && rel.includes(normP)) ||
        (normP && normP.includes(rel));

      if (!matches) {
        continue;
      }

      hits.push({
        slug: mem.slug,
        topic: mem.topic,
        memoryFile: mem.file,
        referencedPath: p,
        changedFile: rel,
        fileExists,
        verdict: fileExists ? "stale-candidate" : "broken",
      });
      break;
    }
  }

  return {
    changedFile: rel,
    fileExists,
    memoriesAffected: hits.length,
    hits,
  };
}

function buildGraph(targetRoot) {
  const data = buildGraphData(targetRoot);
  const paths = writeGraph(targetRoot, data);
  return { counts: data.meta.counts, paths };
}

function loadGraphData(targetRoot) {
  const jsonPath = path.join(fxmindDir(targetRoot), "knowledge-graph.json");
  if (fs.existsSync(jsonPath)) {
    return readJson(jsonPath);
  }
  return null;
}

function canonicalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreNode(node, tokens) {
  const haystack = canonicalize(
    `${node.id} ${node.name} ${node.triggers} ${node.paths} ${node.events} ${node.exports} ${node.resources}`,
  );
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (haystack.includes(token)) score += 1;
    if (node.id && canonicalize(node.id) === token) score += 2;
  }
  return score;
}

/**
 * Query the topic graph. Read-only. Loads memory files for matched + traversed
 * nodes up to a token budget (chars/4). Returns a compact payload the agent can
 * use directly.
 */
function queryGraph(targetRoot, question, options = {}) {
  const graph = loadGraphData(targetRoot);
  if (!graph) {
    return {
      ok: false,
      error: "Missing .fxmind/knowledge-graph.json — run fxmind graph first.",
    };
  }

  const budget = options.budget || 1500;
  const mode = options.dfs ? "dfs" : "bfs";
  const tokens = canonicalize(question).split(/\s+/).filter((t) => t.length >= 3);

  const learned = (graph.nodes || []).filter((n) => n.group === "learned");
  if (learned.length === 0) {
    return { ok: false, error: "No learned topics in graph — run /fxmind learn first." };
  }

  const ranked = learned
    .map((n) => ({ node: n, score: scoreNode(n, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (ranked.length === 0) {
    return {
      ok: true,
      expanded: [],
      memories: [],
      note: "No graph nodes matched the question vocabulary.",
    };
  }

  const startIds = new Set(ranked.map((r) => r.node.id));
  const links = graph.links || [];
  const adjacency = new Map();
  for (const link of links) {
    if (!adjacency.has(link.source)) adjacency.set(link.source, []);
    adjacency.get(link.source).push(link.target);
    if (!adjacency.has(link.target)) adjacency.set(link.target, []);
    adjacency.get(link.target).push(link.source);
  }

  const visited = new Set(startIds);
  const order = [];
  const queue = [...startIds];
  const maxDepth = mode === "dfs" ? 6 : 3;
  const depthMap = new Map([...startIds].map((id) => [id, 0]));

  while (queue.length) {
    const id = mode === "dfs" ? queue.pop() : queue.shift();
    const depth = depthMap.get(id) ?? 0;
    if (depth > maxDepth) continue;
    order.push(id);
    for (const next of adjacency.get(id) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        depthMap.set(next, depth + 1);
        queue.push(next);
      }
    }
  }

  const loaded = [];
  let spent = 0;
  for (const id of order) {
    if (spent >= budget) break;
    const memPath = path.join(memoryDir(targetRoot), `${id}.md`);
    if (!fs.existsSync(memPath)) continue;
    const content = fs.readFileSync(memPath, "utf8");
    const tokensUsed = Math.round(content.length / 4);
    loaded.push({ slug: id, tokens: tokensUsed, content });
    spent += tokensUsed;
  }

  return {
    ok: true,
    mode,
    expanded: order,
    startNodes: [...startIds],
    memories: loaded,
    tokensUsed: spent,
    budget,
  };
}

function gatesPath(targetRoot) {
  return path.join(fxmindDir(targetRoot), GATES_FILE);
}

function legacyGatesPath(targetRoot) {
  return path.join(path.resolve(targetRoot), LEGACY_GATES_REL);
}

function migrateLegacyGates(targetRoot) {
  const next = gatesPath(targetRoot);
  const legacy = legacyGatesPath(targetRoot);
  if (fs.existsSync(next) || !fs.existsSync(legacy)) {
    return false;
  }
  fs.mkdirSync(path.dirname(next), { recursive: true });
  fs.copyFileSync(legacy, next);
  fs.unlinkSync(legacy);
  return true;
}

function gateStatus(targetRoot) {
  migrateLegacyGates(targetRoot);
  return readJson(gatesPath(targetRoot), { gates: {} });
}

function recordGate(targetRoot, gate, value = true, extra = {}) {
  migrateLegacyGates(targetRoot);
  const data = gateStatus(targetRoot);
  data.gates = data.gates || {};
  data.gates[gate] = {
    complete: Boolean(value),
    at: new Date().toISOString(),
    ...extra,
  };
  writeJson(gatesPath(targetRoot), data);
  return data;
}

function resetGates(targetRoot) {
  migrateLegacyGates(targetRoot);
  writeJson(gatesPath(targetRoot), { gates: {}, session: new Date().toISOString() });
}

module.exports = {
  GATES_FILE,
  GATES_REL,
  LEGACY_GATES_REL,
  fxmindDir,
  memoryDir,
  listMemories,
  driftCheck,
  buildGraph,
  queryGraph,
  loadGraphData,
  gateStatus,
  recordGate,
  resetGates,
};
