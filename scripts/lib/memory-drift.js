/**
 * Shared memory drift detection — used by Cursor hooks, git pre-commit, and tests.
 * Reads .fxmind/memory/*.md frontmatter paths[] only; no external deps.
 */
const fs = require("fs");
const path = require("path");

const ALLOW_PREFIXES = [
  ".fxmind/",
  ".cursor/",
  ".claude/",
  ".gemini/",
  ".opencode/",
  ".agents/",
  ".codex/",
  "node_modules/",
];

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const arr = line.match(/^([a-zA-Z0-9_]+):\s*\[(.*)\]\s*$/);
    if (arr) {
      meta[arr[1]] = arr[2]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    const sc = line.match(/^([a-zA-Z0-9_]+):\s*(.+?)\s*$/);
    if (sc) meta[sc[1]] = sc[2].replace(/^["']|["']$/g, "");
  }
  return meta;
}

function normalizeArrayField(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,;|]/).map((p) => p.trim()).filter(Boolean);
  }
  return [];
}

function isCodeFile(rel) {
  if (!rel) return false;
  for (const prefix of ALLOW_PREFIXES) {
    if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) return false;
  }
  return true;
}

function listMemoryFiles(memoryDir) {
  if (!fs.existsSync(memoryDir)) return [];
  return fs
    .readdirSync(memoryDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "_index.md")
    .map((e) => e.name);
}

function pathMatches(rel, referencedPath) {
  const normP = String(referencedPath).replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    normP === rel ||
    normP.endsWith(`/${rel}`) ||
    rel.endsWith(`/${normP}`) ||
    (normP && rel.includes(normP)) ||
    (normP && normP.includes(rel))
  );
}

function driftForFile(projectRoot, rel) {
  const memoryDir = path.join(projectRoot, ".fxmind", "memory");
  const abs = path.resolve(projectRoot, rel);
  const fileExists = fs.existsSync(abs);
  const hits = [];

  for (const name of listMemoryFiles(memoryDir)) {
    const content = fs.readFileSync(path.join(memoryDir, name), "utf8");
    const meta = parseFrontmatter(content);
    const paths = normalizeArrayField(meta.paths);
    const slug = name.replace(/\.md$/i, "");
    for (const p of paths) {
      if (pathMatches(rel, p)) {
        hits.push({
          slug,
          topic: meta.topic || slug,
          memoryFile: `.fxmind/memory/${name}`,
          referencedPath: p,
          verdict: fileExists ? "stale-candidate" : "broken",
        });
        break;
      }
    }
  }

  return { changedFile: rel, fileExists, memoriesAffected: hits.length, hits };
}

function driftForStagedFiles(projectRoot, files, options = {}) {
  const blockStale = Boolean(options.blockStale);
  const results = [];
  const broken = [];
  const stale = [];

  for (const file of files) {
    const rel = String(file).replace(/\\/g, "/");
    if (!isCodeFile(rel)) continue;
    const result = driftForFile(projectRoot, rel);
    if (result.hits.length === 0) continue;
    results.push(result);
    for (const hit of result.hits) {
      if (hit.verdict === "broken") broken.push(hit);
      else stale.push(hit);
    }
  }

  const block = broken.length > 0 || (blockStale && stale.length > 0);
  return { results, broken, stale, block };
}

module.exports = {
  ALLOW_PREFIXES,
  parseFrontmatter,
  isCodeFile,
  driftForFile,
  driftForStagedFiles,
};
