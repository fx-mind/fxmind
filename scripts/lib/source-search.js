"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const IGNORED_DIRS = [".git", ".fxmind", "node_modules", "dist", "build", "vendor", "coverage"];
// Minified bundles and source maps are single huge lines that bury real hits.
const IGNORED_GLOBS = ["*.map", "*.min.js", "*.min.css"];
const GIT_GREP_TIMEOUT_MS = 15_000;

/**
 * Whole-repo literal search through `git grep` (tracked + untracked, honoring
 * .gitignore). It covers every file in well under a second on large FiveM
 * repos, where the JS scan below stops at its byte budget after a few hundred
 * files and reports false "no match" results that make agents retry in loops.
 * Git only reports per-file counts (`-c`): printing the matching lines of
 * minified assets can reach tens of MB. Excerpts are then read from just the
 * first files needed to fill the limit.
 * Returns null when the folder is not inside a Git work tree.
 */
function gitGrep(project, folder, query, maxResults) {
  const excludes = [
    ...IGNORED_DIRS.map((dir) => `:(exclude,glob)**/${dir}/**`),
    ...IGNORED_GLOBS.map((glob) => `:(exclude,glob)**/${glob}`),
  ];
  const args = ["grep", "-c", "-I", "-i", "-F", "--untracked", "--no-color", "-e", query, "--", ".", ...excludes];
  let stdout;
  try {
    stdout = execFileSync("git", args, {
      cwd: folder, encoding: "utf8", timeout: GIT_GREP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
  } catch (error) {
    // Exit 1 without stderr is git grep's "no matches"; anything else falls
    // back to the bounded JS scan.
    if (error.status !== 1 || String(error.stderr || "").trim()) return null;
    stdout = "";
  }
  const files = [];
  let total = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    const hit = /^(.*):(\d+)$/.exec(raw);
    if (!hit) continue;
    files.push(hit[1]);
    total += Number(hit[2]);
  }
  const needle = query.toLowerCase();
  const matches = [];
  for (const rel of files) {
    if (matches.length >= maxResults) break;
    const absolute = path.resolve(folder, rel);
    let content;
    try {
      content = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const file = path.relative(project, absolute).replace(/\\/g, "/");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < maxResults; i += 1) {
      if (lines[i].toLowerCase().includes(needle)) matches.push({ file, line: i + 1, text: lines[i].slice(0, 300) });
    }
  }
  const truncated = total > matches.length;
  let note;
  if (!total) note = "No matches in any tracked or untracked file of this directory (minified bundles/maps excluded). Absence is confirmed; do not retry this literal — try a different term or read the likely file.";
  else if (truncated) note = `${total} matches in ${files.length} files, showing ${matches.length}; narrow the directory or use a more specific literal.`;
  else note = "Complete: every tracked and untracked file was searched (case-insensitive literal).";
  return { ok: true, engine: "git-grep", matches, total, files: files.length, truncated, note };
}

/** Bounded literal source search when the memory graph has no coverage. */
function searchSource(root, { directory = ".", query, limit = 20 } = {}) {
  if (typeof query !== "string" || !query.trim() || query.length > 200) {
    throw new Error("query must be a non-empty literal string of at most 200 characters.");
  }
  const project = fs.realpathSync(root);
  const folder = fs.realpathSync(path.resolve(project, directory));
  const relative = path.relative(project, folder);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Search directory must be inside the project.");
  }
  if (!fs.statSync(folder).isDirectory()) throw new Error("Search directory must be a directory.");
  const maxResults = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.floor(Number(limit)))) : 20;
  const viaGit = gitGrep(project, folder, query, maxResults);
  if (viaGit) return viaGit;
  const ignored = new Set(IGNORED_DIRS);
  let candidates;
  let truncated = false;
  try {
    candidates = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], {
      cwd: folder, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    }).split("\0").filter(Boolean);
  } catch (error) {
    if (!String(error.stderr || "").includes("not a git repository")) throw error;
    candidates = [];
    const pending = [folder];
    let entries = 0;
    while (pending.length && entries < 3000) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (++entries >= 3000) { truncated = true; break; }
        if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (entry.isFile()) candidates.push(path.relative(folder, absolute));
      }
    }
  }
  const matches = [];
  let scanned = 0;
  let bytes = 0;
  const seen = new Set();
  for (const candidate of candidates) {
    if (scanned >= 1000 || bytes >= 8 * 1024 * 1024 || matches.length >= maxResults) { truncated = true; break; }
    if (seen.has(candidate) || candidate.split(/[\\/]/).some((part) => ignored.has(part))) continue;
    seen.add(candidate);
    const absolute = path.resolve(folder, candidate);
    if (!fs.existsSync(absolute)) continue;
    const actual = fs.realpathSync(absolute);
    const rel = path.relative(project, actual);
    if (rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.size > 256 * 1024 || bytes + stat.size > 8 * 1024 * 1024) continue;
    scanned += 1;
    bytes += stat.size;
    const content = fs.readFileSync(absolute, "utf8");
    if (content.includes("\0")) continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].toLowerCase().includes(query.toLowerCase())) continue;
      matches.push({ file: path.relative(project, absolute).replace(/\\/g, "/"), line: i + 1, text: lines[i].slice(0, 300) });
      if (matches.length >= maxResults) { truncated = true; break; }
    }
  }
  return { ok: true, matches, scanned, truncated, note: truncated ? "Bound reached; narrow the directory/query. No-match is not proof of absence." : "Literal case-insensitive search; generated, binary and large files excluded." };
}

module.exports = { searchSource };
