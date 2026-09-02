/**
 * Capture git working-tree diffs for a finished panel run.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const FXMIND_NOISE_RE = [
  /^\.fxmind(\/|$)/i,
  /^\.agents(\/|$)/i,
  /^\.opencode(\/|$)/i,
  /^\.claude(\/|$)/i,
  /^\.codex(\/|$)/i,
  /^opencode\.json$/i,
  /^\.mcp\.json$/i,
  /^\.cursor\/(mcp\.json|skills\/)/i,
];

function git(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 12_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (/not a git repository/i.test(msg)) return null;
    return "";
  }
}

function normalizeRelPath(filePath) {
  return String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function isFxmindNoisePath(filePath) {
  const rel = normalizeRelPath(filePath);
  if (!rel) return false;
  if (/^\.fxmind\/memory(\/|$)/i.test(rel)) return false;
  if (/^\.fxmind\/corrections(\/|$)/i.test(rel)) return false;
  return FXMIND_NOISE_RE.some((re) => re.test(rel));
}

function summarizeFiles(files) {
  const changed = files.length;
  const additions = files.reduce((n, f) => n + (f.additions || 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions || 0), 0);
  const untracked = files.filter((f) => f.status === "untracked").length;
  return {
    summary: changed ? `${changed} arquivo(s) da demanda · +${additions} −${deletions}` : "Sem alterações da demanda",
    stats: { changed, additions, deletions, untracked },
  };
}

function filterTaskFiles(files) {
  return (files || []).filter((file) => !isFxmindNoisePath(file.path));
}

function hashFile(abs) {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

function parsePorcelainLine(line) {
  const raw = String(line || "");
  if (raw.length < 4) return null;
  const xy = raw.slice(0, 2);
  let rest = raw.slice(3).trim();
  if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1);
  const renamed = rest.split(" -> ");
  const file = renamed.length === 2 ? renamed[1] : rest;
  if (!file) return null;
  return { xy, path: normalizeRelPath(file) };
}

function snapshotFilesFromStatus(root, status) {
  const files = {};
  for (const line of String(status || "").split(/\r?\n/)) {
    const entry = parsePorcelainLine(line);
    if (!entry || isFxmindNoisePath(entry.path)) continue;
    files[entry.path] = {
      xy: entry.xy,
      hash: hashFile(path.join(root, entry.path)),
    };
  }
  return files;
}

function snapshot(root) {
  if (!root) return null;
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head === null) return { ok: false, error: "not a git repository" };
  const status = git(root, ["status", "--porcelain"]) || "";
  return {
    ok: true,
    head: String(head || "").trim(),
    status,
    files: snapshotFilesFromStatus(root, status),
  };
}

function pathsChangedSince(root, snap) {
  const now = snapshot(root);
  if (!now || !now.ok) return [];
  const before = (snap && snap.files) || {};
  const out = [];
  for (const [rel, meta] of Object.entries(now.files || {})) {
    const prev = before[rel];
    if (!prev || prev.hash !== meta.hash) out.push(rel);
  }
  return out;
}

const EDIT_NAME_RE = /write|edit|strreplace|applypatch|multiedit|fileedit/i;
const EDIT_LABEL_RE = /^(editou|edited|wrote|updated)\s+/i;
const TEMP_CTX_RE = /fxmind-ctx-/i;

function isEditRecord(item) {
  if (!item || item.kind === "mcp") return false;
  if (item.kind === "write") return true;
  if (EDIT_NAME_RE.test(String(item.name || ""))) return true;
  if (EDIT_LABEL_RE.test(String(item.label || ""))) return true;
  return false;
}

function isTempPath(relOrAbs) {
  const value = String(relOrAbs || "").replace(/\\/g, "/");
  if (!value) return true;
  if (TEMP_CTX_RE.test(value)) return true;
  const tmp = os.tmpdir().replace(/\\/g, "/");
  if (tmp && value.toLowerCase().startsWith(tmp.replace(/\\/g, "/").toLowerCase())) return true;
  return false;
}

function toProjectRel(projectRoot, value) {
  let raw = String(value || "").trim();
  raw = raw.replace(/^(editou|edited|wrote|updated)\s+/i, "");
  if (!raw || isTempPath(raw)) return "";
  const root = path.resolve(String(projectRoot || "")).replace(/\\/g, "/");
  let candidate = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(candidate) || candidate.startsWith("/")) {
    if (!root) return "";
    const abs = path.resolve(raw).replace(/\\/g, "/");
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (abs.toLowerCase() === root.toLowerCase()) return "";
    if (!abs.toLowerCase().startsWith(prefix.toLowerCase())) return "";
    candidate = abs.slice(prefix.length);
  }
  const rel = normalizeRelPath(candidate);
  if (!rel || isFxmindNoisePath(rel) || isTempPath(rel)) return "";
  if (!rel.includes("/") && !/\.\w{1,8}$/.test(rel)) return "";
  return rel;
}

function extractEditedPaths(raw, projectRoot) {
  const root = projectRoot || raw?.projectRoot || "";
  const paths = new Set();
  const consider = (item) => {
    if (!isEditRecord(item)) return;
    const rel = toProjectRel(root, item.detail || "") || toProjectRel(root, item.label || "");
    if (rel) paths.add(rel);
  };
  for (const item of raw?.activity || []) consider(item);
  for (const message of raw?.messages || []) {
    for (const part of message.parts || []) consider(part);
  }
  return paths;
}

function filterDiffToPaths(diff, allowed) {
  const allow = allowed instanceof Set ? allowed : new Set(allowed || []);
  if (!diff || !allow.size) return diff;
  const files = filterTaskFiles((diff.files || []).filter((file) => allow.has(normalizeRelPath(file.path))));
  const meta = summarizeFiles(files);
  return {
    ...diff,
    files,
    summary: meta.summary,
    stats: meta.stats,
  };
}

function taskAllowlist(raw, root) {
  const allow = new Set();
  for (const rel of raw?.taskFiles || []) {
    const pathRel = normalizeRelPath(rel);
    if (pathRel && !isFxmindNoisePath(pathRel)) allow.add(pathRel);
  }
  for (const rel of extractEditedPaths(raw, raw?.projectRoot || root)) allow.add(rel);
  if (allow.size) return allow;
  for (const file of raw?.diff?.files || []) {
    const pathRel = normalizeRelPath(file.path);
    if (pathRel && !isFxmindNoisePath(pathRel)) allow.add(pathRel);
  }
  return allow;
}

function parsePatch(patch) {
  const files = [];
  let current = null;
  for (const line of String(patch || "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const m = line.match(/b\/(.+)$/);
      current = {
        path: m ? m[1] : line.slice(11).trim(),
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: `${line}\n`,
      };
      continue;
    }
    if (!current) continue;
    current.patch += `${line}\n`;
    if (line.startsWith("new file")) current.status = "added";
    else if (line.startsWith("deleted file")) current.status = "deleted";
    else if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }
  if (current) files.push(current);
  return files;
}

function collect(root) {
  if (!root) return { ok: false, error: "no project root" };
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head === null) return { ok: false, error: "not a git repository", files: [], summary: "" };

  const patch = git(root, ["diff", "HEAD"]) || "";
  const porcelain = git(root, ["status", "--porcelain"]) || "";
  const files = parsePatch(patch);

  const untracked = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.startsWith("?? ")) continue;
    untracked.push(line.slice(3).trim());
  }
  for (const path of untracked) {
    if (isFxmindNoisePath(path)) continue;
    if (files.some((f) => f.path === path)) continue;
    files.push({
      path,
      status: "untracked",
      additions: 0,
      deletions: 0,
      patch: "",
    });
  }

  const visible = filterTaskFiles(files);
  const meta = summarizeFiles(visible);

  return {
    ok: true,
    summary: meta.summary,
    files: visible,
    stats: meta.stats,
  };
}

function resolveInsideRoot(root, relPath) {
  const base = path.resolve(root);
  const rel = normalizeRelPath(relPath);
  if (!rel || rel.includes("..") || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    return { ok: false, status: 400, error: "invalid path" };
  }
  const abs = path.resolve(base, rel);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (abs !== base && !abs.startsWith(prefix)) {
    return { ok: false, status: 400, error: "path outside project" };
  }
  return { ok: true, abs, rel };
}

function discardPath(root, relPath) {
  if (!root) return { ok: false, status: 400, error: "no project root" };
  const resolved = resolveInsideRoot(root, relPath);
  if (!resolved.ok) return resolved;
  if (isFxmindNoisePath(resolved.rel)) {
    return { ok: false, status: 400, error: "fxmind files are hidden from the task diff" };
  }

  const porcelain = git(root, ["status", "--porcelain", "--", resolved.rel]);
  if (porcelain === null) return { ok: false, error: "not a git repository" };
  const line = String(porcelain || "")
    .split(/\r?\n/)
    .find(Boolean);
  const untracked = Boolean(line && line.startsWith("??"));

  if (!line) {
    return { ok: false, status: 404, error: "file has no local changes" };
  }
  try {
    if (untracked) {
      if (fs.existsSync(resolved.abs)) {
        fs.rmSync(resolved.abs, { recursive: true, force: true });
      }
    } else {
      const restored = git(root, ["restore", "--worktree", "--staged", "--source=HEAD", "--", resolved.rel]);
      if (restored === null) return { ok: false, error: "not a git repository" };
    }
  } catch (err) {
    return { ok: false, status: 500, error: String(err.message || err) };
  }

  return { ok: true, discarded: resolved.rel };
}

module.exports = {
  snapshot,
  collect,
  parsePatch,
  isFxmindNoisePath,
  filterTaskFiles,
  summarizeFiles,
  discardPath,
  normalizeRelPath,
  toProjectRel,
  extractEditedPaths,
  filterDiffToPaths,
  pathsChangedSince,
  taskAllowlist,
};
