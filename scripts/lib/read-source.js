"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Read-only excerpt of one project file, for hosts that must answer "how does
 * X work?" from the source (the staff chat of PortSpace FiveHub) without any
 * write access. Bounded in lines and bytes, confined to the project root, and
 * it never returns files that commonly hold credentials.
 */

const MAX_LINES = 250;
const MAX_BYTES = 256 * 1024;
const DEFAULT_LINES = 120;

const TEXT_EXTENSIONS = new Set([
  ".lua", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".txt", ".sql",
  ".html", ".css", ".yml", ".yaml", ".xml", ".toml", ".ini",
]);
const BLOCKED_NAMES = /^(\.env.*|server\.cfg|dev\.cfg|.*\.cfg|.*\.key|.*\.pem|.*\.pfx|id_rsa.*)$/i;
const BLOCKED_DIRS = new Set([".git", ".fxmind", "node_modules", ".ssh"]);
// Credentials written inline in Lua/JSON config files.
const SECRET_LINE =
  /(["']?(?:password|passwd|secret|token|api[_-]?key|apikey|webhook|license|licence|steam_?webhook|connection_?string)["']?\s*[:=]\s*)(["'])[^"'\n]{4,}\2/gi;
const URL_SECRET = /(https?:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.[a-z.]+)\/)[^\s"']+/gi;

function redact(text) {
  return text.replace(SECRET_LINE, "$1$2***$2").replace(URL_SECRET, "$1***");
}

function readSource(root, { path: relativePath, startLine = 1, endLine } = {}) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return { ok: false, error: "path is required (relative to the project root)." };
  }
  const project = fs.realpathSync(root);
  const absolute = path.resolve(project, relativePath.replace(/^[\\/]+/, ""));
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    return { ok: false, error: `file not found: ${relativePath}` };
  }
  const relative = path.relative(project, real);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: "path must be a file inside the project." };
  }
  const parts = relative.split(path.sep);
  if (parts.some((part) => BLOCKED_DIRS.has(part)) || BLOCKED_NAMES.test(parts[parts.length - 1])) {
    return { ok: false, error: "this file is not readable here (credentials or internal state)." };
  }
  const stat = fs.statSync(real);
  if (!stat.isFile()) return { ok: false, error: "path is not a file." };
  if (!TEXT_EXTENSIONS.has(path.extname(real).toLowerCase())) {
    return { ok: false, error: "only source and text files can be read." };
  }
  if (stat.size > MAX_BYTES * 4) return { ok: false, error: "file too large; read a narrower file." };

  const content = fs.readFileSync(real, "utf8");
  if (content.includes("\0")) return { ok: false, error: "binary file." };
  const lines = content.split(/\r?\n/);

  const from = Math.max(1, Math.floor(Number(startLine)) || 1);
  const requestedEnd = Number.isFinite(Number(endLine)) ? Math.floor(Number(endLine)) : from + DEFAULT_LINES - 1;
  const to = Math.min(lines.length, Math.max(from, requestedEnd), from + MAX_LINES - 1);
  let excerpt = lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join("\n");
  let truncatedBytes = false;
  if (Buffer.byteLength(excerpt) > MAX_BYTES) {
    excerpt = excerpt.slice(0, MAX_BYTES);
    truncatedBytes = true;
  }
  return {
    ok: true,
    file: relative.replace(/\\/g, "/"),
    startLine: from,
    endLine: to,
    totalLines: lines.length,
    truncated: to < lines.length || truncatedBytes,
    text: redact(excerpt),
  };
}

module.exports = { readSource };
