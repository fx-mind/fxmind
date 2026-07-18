/**
 * fxmind-tools — reusable logic for the MCP server, the `fxmind hooks` CLI,
 * and external integrations. No external deps; pure Node.
 *
 * Operations:
 *  - listMemories / writeMemoryIndex / validateMemories / findMemoryDuplicates
 *  - driftCheck / buildGraph / queryGraph
 *  - startTask / gateStatus / recordGate / resetGates
 *  - recordCorrection / listCorrections / exportCorrections / promoteCorrection
 *  - appendMetric (local .fxmind/metrics.jsonl)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { SHARED_DIR } = require("./global-store");
const { buildGraphData, writeGraph } = require("./build-graph");

const SCHEMA_VERSION = 1;
const GATES_FILE = "fxmind-gates.json";
const GATES_REL = path.join(SHARED_DIR, GATES_FILE);
const LEGACY_GATES_REL = ".fxmind-gates.json";
const MEMORY_INDEX_FILE = "memory-index.json";
const METRICS_FILE = "metrics.jsonl";
const CORRECTIONS_DIR = "corrections";

const CORRECTION_CATEGORIES = [
  "architecture",
  "communication",
  "security",
  "performance",
  "style",
  "api",
];

const CORRECTION_SKILL_TARGETS = {
  architecture: "fivem-development/architecture.md",
  communication: "fivem-development/communication.md",
  security: "fivem-development/security.md",
  performance: "fivem-development/performance.md",
  style: "fivem-development/style.md",
  api: "fivem-development/api.md",
};

const REQUIRED_FRONTMATTER = ["topic", "updated", "lang"];
const RECOMMENDED_ARRAYS = ["paths", "triggers"];

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

function memoryIndexPath(targetRoot) {
  return path.join(fxmindDir(targetRoot), MEMORY_INDEX_FILE);
}

function metricsPath(targetRoot) {
  return path.join(fxmindDir(targetRoot), METRICS_FILE);
}

function correctionsDir(targetRoot) {
  return path.join(fxmindDir(targetRoot), CORRECTIONS_DIR);
}

function ensureCorrectionsDir(targetRoot) {
  const dir = correctionsDir(targetRoot);
  fs.mkdirSync(dir, { recursive: true });
  const indexPath = path.join(dir, "_index.md");
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `# Corrections index

Skill-improvement backlog — not project memory. See \`README.md\`.

| ID | Title | Category | Status | Created |
|----|-------|----------|--------|---------|
| _(none yet)_ | — | — | — | — |

Commands: \`fxmind corrections list\` · \`fxmind corrections export\` · \`fxmind corrections promote <id>\`
`,
      "utf8",
    );
  }
  const readmePath = path.join(dir, "README.md");
  if (!fs.existsSync(readmePath)) {
    const template = path.join(__dirname, "..", "templates", "fxmind", "corrections", "README.md");
    if (fs.existsSync(template)) {
      fs.copyFileSync(template, readmePath);
    }
  }
  return dir;
}

function slugifyCorrection(title) {
  return String(title || "correction")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "correction";
}

function newCorrectionId(title) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const slug = slugifyCorrection(title);
  const short = crypto.randomBytes(2).toString("hex");
  return `${stamp}-${slug}-${short}`;
}

function rebuildCorrectionsIndex(targetRoot) {
  const dir = ensureCorrectionsDir(targetRoot);
  const items = listCorrections(targetRoot);
  const lines = [
    "# Corrections index",
    "",
    "Skill-improvement backlog — not project memory. See `README.md`.",
    "",
    "| ID | Title | Category | Status | Created |",
    "|----|-------|----------|--------|---------|",
  ];
  if (items.length === 0) {
    lines.push("| _(none yet)_ | — | — | — | — |");
  } else {
    for (const item of items) {
      lines.push(
        `| \`${item.id}\` | ${item.title} | ${item.category} | ${item.status} | ${item.created} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    "Commands: `fxmind corrections list` · `fxmind corrections export` · `fxmind corrections promote <id>`",
  );
  lines.push("");
  fs.writeFileSync(path.join(dir, "_index.md"), `${lines.join("\n")}\n`, "utf8");
  return items.length;
}

function listCorrections(targetRoot, options = {}) {
  const dir = correctionsDir(targetRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name === "_index.md" || entry.name === "README.md") continue;
    if (entry.name.includes("template")) continue;
    const content = fs.readFileSync(path.join(dir, entry.name), "utf8");
    const meta = parseFrontmatter(content);
    const id = meta.id || entry.name.replace(/\.md$/i, "");
    const item = {
      id,
      file: path.join(SHARED_DIR, CORRECTIONS_DIR, entry.name).replace(/\\/g, "/"),
      title: meta.title || id,
      category: meta.category || "style",
      status: meta.status || "open",
      severity: meta.severity || "high",
      created: meta.created || "",
      commit: meta.commit || "",
      skill_target: meta.skill_target || CORRECTION_SKILL_TARGETS[meta.category] || "fivem-development/best-practices.md",
      promoted_at: meta.promoted_at || "",
      content,
    };
    if (options.status && item.status !== options.status) continue;
    if (options.category && item.category !== options.category) continue;
    out.push(item);
  }
  out.sort((a, b) => String(b.created).localeCompare(String(a.created)) || a.id.localeCompare(b.id));
  return out;
}

function recordCorrection(targetRoot, input = {}) {
  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("correction title is required");
  }
  const category = String(input.category || "style").toLowerCase();
  if (!CORRECTION_CATEGORIES.includes(category)) {
    throw new Error(
      `invalid category "${category}" — use: ${CORRECTION_CATEGORIES.join(", ")}`,
    );
  }
  const dir = ensureCorrectionsDir(targetRoot);
  const id = input.id || newCorrectionId(title);
  const fileName = `${id}.md`;
  const filePath = path.join(dir, fileName);
  if (fs.existsSync(filePath) && !input.overwrite) {
    throw new Error(`correction already exists: ${id}`);
  }

  const bad = String(input.bad || "").trim() || "(not provided)";
  const good = String(input.good || "").trim() || "(not provided)";
  const rule = String(input.rule || "").trim() || "(derive a one-line rule for best-practices)";
  const notes = String(input.notes || "").trim() || "—";
  const created = input.created || new Date().toISOString().slice(0, 10);
  const paths = normalizeArrayField(input.paths);
  const resources = normalizeArrayField(input.resources);

  const body = `---
id: ${id}
title: "${title.replace(/"/g, '\\"')}"
category: ${category}
status: open
severity: ${input.severity || "high"}
created: ${created}
commit: ${input.commit || ""}
resources: [${resources.join(", ")}]
paths: [${paths.join(", ")}]
skill_target: ${input.skill_target || CORRECTION_SKILL_TARGETS[category] || "fivem-development/best-practices.md"}
promoted_at: ""
---

# ${title}

## Bad (agent)

${bad}

## Good (human fix)

${good}

## Rule (for skill)

${rule}

## Notes

${notes}
`;

  fs.writeFileSync(filePath, body, "utf8");
  rebuildCorrectionsIndex(targetRoot);
  appendMetric(targetRoot, {
    event: "correction_record",
    id,
    category,
  });
  return {
    ok: true,
    id,
    file: path.join(SHARED_DIR, CORRECTIONS_DIR, fileName).replace(/\\/g, "/"),
    category,
  };
}

function promoteCorrection(targetRoot, id) {
  const items = listCorrections(targetRoot);
  const item = items.find((c) => c.id === id);
  if (!item) {
    throw new Error(`correction not found: ${id}`);
  }
  const abs = path.join(path.resolve(targetRoot), item.file);
  let content = fs.readFileSync(abs, "utf8");
  const now = new Date().toISOString().slice(0, 10);
  // Use [ \\t] not \\s — \\s can eat the newline and swallow the closing --- fence.
  if (/^status:[ \t]*/m.test(content)) {
    content = content.replace(/^status:[ \t]*.*$/m, "status: promoted");
  } else {
    content = content.replace(/^---\r?\n/, `---\nstatus: promoted\n`);
  }
  if (/^promoted_at:[ \t]*/m.test(content)) {
    content = content.replace(/^promoted_at:[ \t]*.*$/m, `promoted_at: ${now}`);
  } else {
    content = content.replace(/^---\r?\n/, `---\npromoted_at: ${now}\n`);
  }
  fs.writeFileSync(abs, content, "utf8");
  rebuildCorrectionsIndex(targetRoot);
  appendMetric(targetRoot, { event: "correction_promote", id });
  return { ok: true, id, status: "promoted", promoted_at: now };
}

function exportCorrections(targetRoot, options = {}) {
  const items = listCorrections(targetRoot, {
    status: options.status || "open",
    category: options.category || null,
  });
  if (options.format === "json") {
    return {
      ok: true,
      format: "json",
      schemaVersion: SCHEMA_VERSION,
      count: items.length,
      corrections: items.map(({ content, ...rest }) => rest),
    };
  }

  const lines = [
    `# fxmind corrections export`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Filter: status=${options.status || "open"}${options.category ? ` category=${options.category}` : ""}`,
    `Count: ${items.length}`,
    ``,
    `Use this digest to update pack skills (e.g. \`fivem-development/architecture.md\` by category).`,
    ``,
  ];
  for (const item of items) {
    lines.push(`## ${item.id} — ${item.title}`);
    lines.push(``);
    lines.push(`- category: \`${item.category}\``);
    lines.push(`- severity: \`${item.severity}\``);
    lines.push(`- skill_target: \`${item.skill_target}\``);
    if (item.commit) lines.push(`- commit: \`${item.commit}\``);
    lines.push(``);
    const bad = (item.content.match(/## Bad \(agent\)\s*\n([\s\S]*?)(?=\n## )/m) || [])[1];
    const good = (item.content.match(/## Good \(human fix\)\s*\n([\s\S]*?)(?=\n## )/m) || [])[1];
    const rule = (item.content.match(/## Rule \(for skill\)\s*\n([\s\S]*?)(?=\n## |\n*$)/m) || [])[1];
    lines.push(`### Bad`);
    lines.push((bad || "").trim() || "_(empty)_");
    lines.push(``);
    lines.push(`### Good`);
    lines.push((good || "").trim() || "_(empty)_");
    lines.push(``);
    lines.push(`### Proposed skill rule`);
    lines.push((rule || "").trim() || "_(empty)_");
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  return {
    ok: true,
    format: "md",
    count: items.length,
    markdown: lines.join("\n"),
  };
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
      lang: meta.lang || "",
      confidence: meta.confidence || "",
      resources: normalizeArrayField(meta.resources),
      paths: normalizeArrayField(meta.paths),
      events: normalizeArrayField(meta.events),
      exports: normalizeArrayField(meta.exports),
      symbols: normalizeArrayField(meta.symbols),
      triggers: normalizeArrayField(meta.triggers),
      bytes: Buffer.byteLength(content, "utf8"),
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

/**
 * Validate one memory file (or content). Returns { ok, errors[], warnings[] }.
 */
function validateMemory(targetRoot, options = {}) {
  const errors = [];
  const warnings = [];
  let slug = options.slug || "";
  let content = options.content || "";
  let fileRel = options.file || "";

  if (options.filePath) {
    const abs = path.resolve(options.filePath);
    content = fs.readFileSync(abs, "utf8");
    slug = slug || path.basename(abs, ".md").toLowerCase();
    fileRel = path.relative(path.resolve(targetRoot), abs).replace(/\\/g, "/");
  }

  if (!content.trim()) {
    errors.push("empty file");
    return { ok: false, slug, file: fileRel, errors, warnings };
  }

  if (!/^---\r?\n/.test(content)) {
    errors.push("missing YAML frontmatter");
    return { ok: false, slug, file: fileRel, errors, warnings };
  }

  const meta = parseFrontmatter(content);
  for (const key of REQUIRED_FRONTMATTER) {
    if (!meta[key] || !String(meta[key]).trim()) {
      errors.push(`missing frontmatter field: ${key}`);
    }
  }

  if (meta.lang && meta.lang !== "en-compact") {
    warnings.push(`lang should be en-compact (got: ${meta.lang})`);
  }

  if (!meta.confidence) {
    warnings.push("missing confidence (recommended: extracted)");
  }

  const paths = normalizeArrayField(meta.paths);
  const triggers = normalizeArrayField(meta.triggers);

  if (paths.length === 0 && triggers.length === 0) {
    errors.push("paths[] and triggers[] are both empty — memory cannot be routed");
  } else {
    if (paths.length === 0) warnings.push("paths[] empty");
    if (triggers.length === 0) warnings.push("triggers[] empty");
  }

  if (options.checkPaths !== false && paths.length > 0) {
    const root = path.resolve(targetRoot);
    let missing = 0;
    for (const p of paths) {
      const abs = path.resolve(root, p);
      if (!fs.existsSync(abs)) {
        missing += 1;
        if (missing <= 5) {
          warnings.push(`path not found: ${p}`);
        }
      }
    }
    if (missing > 5) {
      warnings.push(`…and ${missing - 5} more missing paths`);
    }
  }

  const topicSlug = String(meta.topic || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug && topicSlug && topicSlug !== slug && !slug.startsWith(topicSlug)) {
    warnings.push(`topic "${meta.topic}" does not match filename slug "${slug}"`);
  }

  return {
    ok: errors.length === 0,
    slug,
    file: fileRel,
    errors,
    warnings,
  };
}

function validateMemories(targetRoot, options = {}) {
  const dir = memoryDir(targetRoot);
  const results = [];
  if (!fs.existsSync(dir)) {
    return { ok: true, schemaVersion: SCHEMA_VERSION, checked: 0, failed: 0, results: [] };
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "_index.md") {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    results.push(
      validateMemory(targetRoot, {
        filePath,
        slug: entry.name.replace(/\.md$/i, "").toLowerCase(),
        checkPaths: options.checkPaths !== false,
      }),
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  return {
    ok: failed === 0,
    schemaVersion: SCHEMA_VERSION,
    checked: results.length,
    failed,
    warned: results.filter((r) => r.warnings.length > 0).length,
    results,
  };
}

function findMemoryDuplicates(targetRoot) {
  const memories = listMemories(targetRoot);
  const byTrigger = new Map();
  const byPath = new Map();
  const duplicates = [];

  for (const mem of memories) {
    for (const t of mem.triggers) {
      const key = t.toLowerCase();
      if (!byTrigger.has(key)) byTrigger.set(key, []);
      byTrigger.get(key).push(mem.slug);
    }
    for (const p of mem.paths) {
      const key = p.replace(/\\/g, "/").toLowerCase();
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key).push(mem.slug);
    }
  }

  for (const [trigger, slugs] of byTrigger) {
    const unique = [...new Set(slugs)];
    if (unique.length > 1) {
      duplicates.push({ type: "trigger", value: trigger, slugs: unique });
    }
  }
  for (const [p, slugs] of byPath) {
    const unique = [...new Set(slugs)];
    if (unique.length > 1) {
      duplicates.push({ type: "path", value: p, slugs: unique });
    }
  }

  return duplicates;
}

function buildMemoryIndex(targetRoot) {
  const memories = listMemories(targetRoot);
  const validation = validateMemories(targetRoot, { checkPaths: true });
  const duplicates = findMemoryDuplicates(targetRoot);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    count: memories.length,
    memories,
    duplicates,
    validation: {
      ok: validation.ok,
      failed: validation.failed,
      warned: validation.warned,
    },
  };
}

function writeMemoryIndex(targetRoot) {
  const index = buildMemoryIndex(targetRoot);
  const outPath = memoryIndexPath(targetRoot);
  writeJson(outPath, index);
  return {
    path: path.relative(path.resolve(targetRoot), outPath).replace(/\\/g, "/"),
    count: index.count,
    duplicates: index.duplicates.length,
    validation: index.validation,
  };
}

function loadMemoryIndex(targetRoot) {
  return readJson(memoryIndexPath(targetRoot), null);
}

function appendMetric(targetRoot, event) {
  try {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      ...event,
    });
    const file = metricsPath(targetRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}\n`, "utf8");
  } catch {
    // metrics are best-effort
  }
}

function normalizeRepoPath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Drift check: given a changed file (relative to project root, or absolute),
 * return memories whose frontmatter paths[] reference it.
 */
function driftCheck(targetRoot, changedFile) {
  const resolved = path.resolve(targetRoot, changedFile);
  const rel = path.relative(path.resolve(targetRoot), resolved).replace(/\\/g, "/");
  const fileExists = fs.existsSync(resolved);
  const memories = listMemories(targetRoot);
  const hits = [];

  for (const mem of memories) {
    for (const p of mem.paths) {
      const normP = normalizeRepoPath(p);
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

  const result = {
    changedFile: rel,
    fileExists,
    memoriesAffected: hits.length,
    hits,
  };
  appendMetric(targetRoot, {
    event: "drift_check",
    changedFile: rel,
    hits: hits.length,
  });
  return result;
}

function buildGraph(targetRoot) {
  const data = buildGraphData(targetRoot);
  if (!data.meta) data.meta = {};
  data.meta.schemaVersion = SCHEMA_VERSION;
  const paths = writeGraph(targetRoot, data);
  const index = writeMemoryIndex(targetRoot);
  appendMetric(targetRoot, {
    event: "graph_build",
    learned: data.meta?.counts?.learned,
    links: data.meta?.counts?.links,
  });
  return { counts: data.meta.counts, paths, memoryIndex: index };
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
 * nodes up to a token budget (chars/4).
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

  const result = {
    ok: true,
    mode,
    expanded: order,
    startNodes: [...startIds],
    memories: loaded,
    tokensUsed: spent,
    budget,
  };
  appendMetric(targetRoot, {
    event: "query",
    mode,
    tokensUsed: spent,
    memories: loaded.length,
  });
  return result;
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
  return readJson(gatesPath(targetRoot), {
    schemaVersion: SCHEMA_VERSION,
    taskActive: false,
    gates: {},
  });
}

function startTask(targetRoot, extra = {}) {
  migrateLegacyGates(targetRoot);
  const data = {
    schemaVersion: SCHEMA_VERSION,
    taskActive: true,
    session: new Date().toISOString(),
    autoStarted: Boolean(extra.autoStarted),
    gates: {},
    ...extra,
  };
  if (extra.note) {
    data.note = extra.note;
  }
  writeJson(gatesPath(targetRoot), data);
  appendMetric(targetRoot, { event: "task_start", autoStarted: data.autoStarted });
  return data;
}

function recordGate(targetRoot, gate, value = true, extra = {}) {
  migrateLegacyGates(targetRoot);
  const letter = String(gate || "").toUpperCase();

  if (letter === "START" || letter === "0") {
    return startTask(targetRoot, {
      note: extra.note || "",
      autoStarted: false,
    });
  }

  if (!["A", "B", "C"].includes(letter)) {
    throw new Error(`Invalid gate: ${gate} (use START, A, B, or C)`);
  }

  let data = gateStatus(targetRoot);
  if (!data.taskActive) {
    data.taskActive = true;
    data.session = data.session || new Date().toISOString();
  }
  data.schemaVersion = SCHEMA_VERSION;
  data.gates = data.gates || {};
  data.gates[letter] = {
    complete: Boolean(value),
    at: new Date().toISOString(),
    ...(extra.note ? { note: extra.note } : {}),
  };

  if (letter === "C" && value) {
    data.taskActive = false;
    data.completedAt = new Date().toISOString();
  }

  writeJson(gatesPath(targetRoot), data);
  appendMetric(targetRoot, {
    event: "gate_record",
    gate: letter,
    complete: Boolean(value),
    taskActive: data.taskActive,
  });
  return data;
}

function resetGates(targetRoot) {
  migrateLegacyGates(targetRoot);
  const data = {
    schemaVersion: SCHEMA_VERSION,
    taskActive: false,
    gates: {},
    session: new Date().toISOString(),
  };
  writeJson(gatesPath(targetRoot), data);
  return data;
}

/** Lines to ensure in the project .gitignore */
const PROJECT_GITIGNORE_LINES = [
  ".fxmind/fxmind-gates.json",
  ".fxmind-gates.json",
  ".fxmind/metrics.jsonl",
];

function ensureProjectGitignore(targetRoot) {
  const gitignorePath = path.join(path.resolve(targetRoot), ".gitignore");
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const added = [];
  for (const line of PROJECT_GITIGNORE_LINES) {
    const re = new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (re.test(content)) continue;
    if (content.length && !content.endsWith("\n")) content += "\n";
    if (!content.includes("# fxmind session")) {
      content += `\n# fxmind session (do not commit)\n`;
    }
    content += `${line}\n`;
    added.push(line);
  }
  if (added.length) {
    fs.writeFileSync(gitignorePath, content, "utf8");
  }
  return { path: ".gitignore", added };
}

module.exports = {
  SCHEMA_VERSION,
  GATES_FILE,
  GATES_REL,
  LEGACY_GATES_REL,
  MEMORY_INDEX_FILE,
  METRICS_FILE,
  PROJECT_GITIGNORE_LINES,
  fxmindDir,
  memoryDir,
  parseFrontmatter,
  listMemories,
  validateMemory,
  validateMemories,
  findMemoryDuplicates,
  buildMemoryIndex,
  writeMemoryIndex,
  loadMemoryIndex,
  driftCheck,
  buildGraph,
  queryGraph,
  loadGraphData,
  gateStatus,
  startTask,
  recordGate,
  resetGates,
  appendMetric,
  ensureProjectGitignore,
  CORRECTION_CATEGORIES,
  CORRECTIONS_DIR,
  correctionsDir,
  ensureCorrectionsDir,
  listCorrections,
  recordCorrection,
  promoteCorrection,
  exportCorrections,
  rebuildCorrectionsIndex,
};
