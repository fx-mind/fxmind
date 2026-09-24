/**
 * fxmind-tools — reusable logic for the MCP server, the `fxmind hooks` CLI,
 * and external integrations. No external deps; pure Node.
 *
 * Operations:
 *  - listMemories / writeMemoryIndex / validateMemories / findMemoryDuplicates
 *  - driftCheck / buildGraph / queryGraph
 *  - startTask / gateStatus / recordGate / resetGates
 *  - recordCorrection / listCorrections / exportCorrections / promoteCorrection
 *  - appendMetric (local .fxmind/state/metrics.jsonl)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { SHARED_DIR, resolveDataRoot } = require("./global-store");
const {
  resolveLocal,
  writeLocal,
  resolveInDataRoot,
  writeInDataRoot,
  ensureDirFor,
  projectRel,
  REL,
  PROJECT_GITIGNORE_LINES,
} = require("./lib/layout");
const { buildGraphData, writeGraph } = require("./build-graph");
const { isGraphStale, ensureGraphFresh } = require("./lib/graph-freshness");
const { ensureProjectGitignore } = require("./lib/project-gitignore");
const taskSessions = require("./lib/task-sessions");
const { withFileLock } = require("./lib/fs-lock");
const retrieval = require("./lib/memory-retrieval");

const SCHEMA_VERSION = 1;
const GATES_FILE = "fxmind-gates.json";
const GATES_REL = projectRel(REL.gates);
const LEGACY_GATES_REL = ".fxmind-gates.json";
const MEMORY_INDEX_FILE = REL.memoryIndexJson;
const METRICS_FILE = REL.metrics;
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
  return resolveInDataRoot(resolveDataRoot(targetRoot), "memoryIndexJson");
}

function memoryIndexWritePath(targetRoot) {
  return writeInDataRoot(resolveDataRoot(targetRoot), "memoryIndexJson");
}

function metricsPath(targetRoot) {
  return writeLocal(targetRoot, "metrics");
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
    `Use this digest to update pack skills (e.g. \`fivem-development/architecture.md\` by category): fold each rule into the section it refines as one \`**Rule (ID):**\` line (principle ID from \`.fxmind/policy/fivem-principles.md\`) — never a new "Learned rule" section.`,
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
  return withFileLock(path.resolve(targetRoot), "memory-index", () => {
    const index = buildMemoryIndex(targetRoot);
    const outPath = memoryIndexWritePath(targetRoot);
    writeJson(outPath, index);
    return {
      path: path.relative(path.resolve(targetRoot), outPath).replace(/\\/g, "/"),
      count: index.count,
      duplicates: index.duplicates.length,
      validation: index.validation,
    };
  });
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

function buildGraph(targetRoot, options = {}) {
  return withFileLock(path.resolve(targetRoot), "graph-rebuild", () => {
    const updateHtml = options.updateHtml !== false;
    const data = buildGraphData(targetRoot, { useCache: options.useCache !== false });
    if (!data.meta) data.meta = {};
    data.meta.schemaVersion = SCHEMA_VERSION;
    const paths = writeGraph(targetRoot, data, { updateHtml });
    const index = writeMemoryIndex(targetRoot);
    appendMetric(targetRoot, {
      event: "graph_build",
      learned: data.meta?.counts?.learned,
      links: data.meta?.counts?.links,
      updateHtml,
    });
    return { counts: data.meta.counts, paths, memoryIndex: index };
  });
}

function loadGraphData(targetRoot) {
  const jsonPath = resolveInDataRoot(resolveDataRoot(targetRoot), "graphJson");
  if (jsonPath && fs.existsSync(jsonPath)) {
    return readJson(jsonPath);
  }
  return null;
}

/**
 * Query project memories for a question. Read-only. Ranks memories with
 * lib/memory-retrieval (PT↔EN, rare terms weigh more), loads only the
 * matching sections that fit the token budget (chars/4) and lists graph
 * neighbours as related topics instead of loading them. `dfs: true` also
 * loads related memories with any budget left.
 */
function queryGraph(targetRoot, question, options = {}) {
  const rebuild = options.rebuild !== false;
  let graph = loadGraphData(targetRoot);
  const stale = !graph || isGraphStale(targetRoot);
  if (rebuild && stale) {
    ensureGraphFresh(targetRoot, { updateHtml: false, useCache: true });
    graph = loadGraphData(targetRoot);
  }
  const graphStale = stale && !rebuild;

  const requestedBudget = Number(options.budget);
  const budget = Number.isFinite(requestedBudget) && requestedBudget > 0
    ? Math.max(1, Math.min(8000, Math.floor(requestedBudget))) : 1500;
  const mode = options.dfs ? "dfs" : "bfs";

  const memories = listMemories(targetRoot).map((memory) => ({
    ...memory,
    absFile: path.join(memoryDir(targetRoot), path.basename(memory.file)),
  }));
  if (memories.length === 0) {
    return graph
      ? { ok: false, error: "No learned topics in graph — run /fxmind learn first." }
      : { ok: false, error: "Missing knowledge-graph.json — run fxmind graph or /fxmind learn first." };
  }
  // Ranking reads memory files directly; without a graph only `related` is empty.

  const contents = new Map();
  const readContent = (memory) => {
    if (!contents.has(memory.slug)) {
      let text = "";
      try {
        text = fs.readFileSync(memory.absFile, "utf8");
      } catch {
        text = "";
      }
      contents.set(memory.slug, text);
    }
    return contents.get(memory.slug);
  };
  const { concepts, hits } = retrieval.rankMemories(question, memories, readContent);

  if (hits.length === 0) {
    return {
      ok: true,
      graphStale,
      mode,
      expanded: [],
      memories: [],
      note: "No memory matched the question vocabulary.",
    };
  }

  const hitIds = new Set(hits.map((hit) => hit.doc.memory.slug));
  const names = new Map(memories.map((m) => [m.slug, m.topic || m.slug]));
  const related = [];
  const relatedSeen = new Set(hitIds);
  for (const link of graph?.links || []) {
    for (const [from, to] of [[link.source, link.target], [link.target, link.source]]) {
      if (hitIds.has(from) && names.has(to) && !relatedSeen.has(to)) {
        relatedSeen.add(to);
        related.push({ slug: to, name: names.get(to) });
      }
    }
  }

  const loaded = [];
  let spent = 0;
  const pushMemory = (doc, cap, score, matched) => {
    const fitted = retrieval.fitMemory(doc, concepts, cap);
    const tokens = retrieval.estimateTokens(fitted.content);
    loaded.push({
      slug: doc.memory.slug,
      topic: doc.memory.topic,
      file: doc.memory.absFile,
      path: doc.memory.file,
      score: Math.round(score * 100) / 100,
      matched,
      tokens,
      content: fitted.content,
      truncated: fitted.truncated,
      omittedSections: fitted.omittedSections,
    });
    spent += tokens;
  };

  // Budget share follows relevance; unused share flows to the next hit.
  let remainingScore = hits.reduce((sum, hit) => sum + hit.score, 0);
  for (const hit of hits) {
    const remaining = budget - spent;
    if (remaining <= 0) break;
    const cap = Math.max(1, Math.floor((remaining * hit.score) / remainingScore));
    remainingScore -= hit.score;
    pushMemory(hit.doc, cap, hit.score, hit.matched);
  }

  if (mode === "dfs") {
    for (const rel of related) {
      const remaining = budget - spent;
      if (remaining < 40) break;
      const memory = memories.find((m) => m.slug === rel.slug);
      pushMemory(retrieval.buildDoc(memory, readContent(memory)), remaining, 0, []);
    }
  }
  const loadedIds = new Set(loaded.map((m) => m.slug));

  const result = {
    ok: true,
    graphStale,
    mode,
    expanded: [...hitIds, ...related.map((r) => r.slug)],
    startNodes: [...hitIds],
    memories: loaded,
    related: related.filter((r) => !loadedIds.has(r.slug)).slice(0, 8),
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
  return writeLocal(targetRoot, "gates");
}

function legacyGatesPath(targetRoot) {
  return path.join(path.resolve(targetRoot), LEGACY_GATES_REL);
}

function migrateLegacyGates(targetRoot) {
  const next = gatesPath(targetRoot);
  const fromRoot = path.join(fxmindDir(targetRoot), GATES_FILE);
  const fromRepo = legacyGatesPath(targetRoot);

  if (fs.existsSync(next)) {
    if (fs.existsSync(fromRepo)) {
      fs.unlinkSync(fromRepo);
    }
    return false;
  }

  const source = fs.existsSync(fromRoot) && fromRoot !== next
    ? fromRoot
    : fs.existsSync(fromRepo)
      ? fromRepo
      : null;
  if (!source) {
    return false;
  }

  fs.mkdirSync(path.dirname(next), { recursive: true });
  fs.copyFileSync(source, next);
  fs.unlinkSync(source);
  if (source !== fromRepo && fs.existsSync(fromRepo)) {
    fs.unlinkSync(fromRepo);
  }
  return true;
}

function gateStatus(targetRoot, extra = {}) {
  migrateLegacyGates(targetRoot);
  return taskSessions.getSessionStatus(targetRoot, extra);
}

const USER_REPLY_STYLE =
  "Reply to the user short and direct. Lead with the outcome. No long explanations, tables, or gate ceremony in chat.";

function withUserReply(data, gate) {
  if (!data || data.error) return data;
  const letter = String(gate || "START").toUpperCase();
  if (letter === "START" || letter === "0" || letter === "A") {
    return { ...data, userReply: USER_REPLY_STYLE };
  }
  return data;
}

function startTask(targetRoot, extra = {}) {
  migrateLegacyGates(targetRoot);
  try {
    ensureProjectGitignore(targetRoot);
  } catch {
    // gitignore heal is best-effort
  }
  const data = taskSessions.startSession(targetRoot, {
    note: extra.note || "",
    trivial: Boolean(extra.trivial),
    ui: Boolean(extra.ui),
    autoStarted: Boolean(extra.autoStarted),
    sessionId: extra.sessionId,
    conversationId: extra.conversationId,
  });
  appendMetric(targetRoot, {
    event: "task_start",
    sessionId: data.sessionId,
    autoStarted: data.autoStarted,
    trivial: data.trivial,
  });
  return withUserReply(data, "START");
}

function recordGate(targetRoot, gate, value = true, extra = {}) {
  migrateLegacyGates(targetRoot);
  const letter = String(gate || "").toUpperCase();

  if (letter === "START" || letter === "0") {
    return startTask(targetRoot, {
      note: extra.note || "",
      autoStarted: false,
      trivial: Boolean(extra.trivial),
      ui: Boolean(extra.ui),
      sessionId: extra.sessionId,
      conversationId: extra.conversationId,
    });
  }

  if (!["A", "B", "V", "C"].includes(letter)) {
    throw new Error(`Invalid gate: ${gate} (use START, A, B, V, or C)`);
  }

  const data = taskSessions.recordSessionGate(targetRoot, letter, value, {
    sessionId: extra.sessionId,
    note: extra.note,
    evidence: extra.evidence,
    conversationId: extra.conversationId,
  });
  if (data && data.error === "multiple_active_sessions") {
    return data;
  }
  appendMetric(targetRoot, {
    event: "gate_record",
    gate: letter,
    complete: Boolean(value),
    taskActive: data.taskActive,
    sessionId: data.sessionId,
  });
  return withUserReply(data, letter);
}

function claimPaths(targetRoot, paths, extra = {}) {
  return taskSessions.claimPaths(targetRoot, paths, extra);
}

function releasePaths(targetRoot, paths, extra = {}) {
  return taskSessions.releasePaths(targetRoot, paths, extra);
}

function sessionStatus(targetRoot) {
  return taskSessions.listSessionsStatus(targetRoot);
}

function resetGates(targetRoot) {
  migrateLegacyGates(targetRoot);
  return taskSessions.resetSessions(targetRoot);
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
  isGraphStale,
  ensureGraphFresh,
  gateStatus,
  startTask,
  recordGate,
  USER_REPLY_STYLE,
  claimPaths,
  releasePaths,
  sessionStatus,
  resetGates,
  taskSessions,
  withFileLock,
  withFileLockAsync: require("./lib/fs-lock").withFileLockAsync,
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
