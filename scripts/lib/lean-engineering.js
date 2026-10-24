"use strict";
/**
 * Lean engineering guidance, inspired by Ponytail (MIT).
 * No model calls or new MCP tools. The map is advisory, not a parser.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const SOURCE = /\.(?:lua|js|jsx|mjs|cjs|ts|tsx|py|go|rs)$/i;
const EXCLUDED = /(^|\/)(?:node_modules|vendor|dist|build|coverage|\.next|\.git|\.fxmind|tests?|__tests__|fixtures|generated|cache)(\/|$)/i;
const NORMALIZE = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const STOP = new Set("para como deve pode quero fazer criar nova novo uma quando onde pelo pela erro bug fix implementar alterar corrigir o a os as de da do das dos e em na no ou por the and from server client script arquivo sistema codigo".split(" "));

function leanPlan(kind) {
  if (!["config", "fix", "mechanic", "create"].includes(kind)) return "";
  const first = kind === "config" ? "Prefer one existing configuration entry."
    : kind === "fix" ? "Reproduce and fix the root cause in existing code."
    : kind === "mechanic" ? "Trace the existing flow and update it in place."
    : "First check whether the requested behavior already exists.";
  return [
    "# FXMIND Lean plan (advisory; use at existing Gate B)",
    first,
    "Before creating files, helpers, events or dependencies: check existing project code, standard/platform features, then installed dependencies.",
    "Choose the smallest COMPLETE change; cover affected callers, security, error handling, accessibility and required tests. Do not optimize for line count alone.",
    "State the reuse decision and one concrete regression check. Never skip mandatory Gates A/B/V/C."
  ].join("\n");
}

function symbols(file, body) {
  const rules = /\.lua$/i.test(file) ? [
    /(?:^|\n)\s*(?:local\s+)?function\s+([\w.:]+)/g,
    /\b(?:RegisterNetEvent|AddEventHandler|RegisterNUICallback|RegisterCommand|exports)\s*\(\s*["']([^"']+)/g,
    /\blib\.callback\.register\s*\(\s*["']([^"']+)/g,
  ] : [
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|class|function|async function)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:def|class)\s+([A-Za-z_]\w*)\b/g,
    /\b(?:pub\s+)?(?:fn|struct|type)\s+([A-Za-z_]\w*)\b/g,
  ];
  const seen = new Set();
  for (const re of rules) for (const hit of body.matchAll(re)) {
    if (seen.size >= 10) break;
    if (hit[1] && hit[1].length < 100) seen.add(hit[1]);
  }
  return [...seen];
}

function codebaseMap(root, prompt, options = {}) {
  if (!root || options.enabled === false) return "";
  const base = path.resolve(root);
  const maxChars = Math.min(Math.max(Number(options.maxChars) || 1100, 200), 1800);
  const words = [...new Set(NORMALIZE(prompt).match(/[a-z0-9_]{4,}/g) || [])]
    .filter(word => !STOP.has(word)).slice(0, 12);
  if (!words.length) return "";
  let files;
  try {
    files = execFileSync("git", ["ls-files", "-z", "--cached"], {
      cwd: base, encoding: "utf8", timeout: 1800, maxBuffer: 6 * 1024 * 1024,
      windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean);
  } catch {
    return ""; // no git or very large repo: regular FxMind source search works
  }
  const hits = files.filter(f => SOURCE.test(f) && !EXCLUDED.test(f.replace(/\\/g, "/")))
    .map(f => ({ f, score: words.reduce((s, w) => s + (NORMALIZE(f).includes(w) ? 5 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.localeCompare(b.f)).slice(0, 45);
  const lines = [];
  let used = 0;
  for (const { f } of hits) {
    const full = path.resolve(base, f);
    if (!full.startsWith(base + path.sep)) continue;
    try {
      if (!fs.lstatSync(full).isFile()) continue;
      const fd = fs.openSync(full, "r");
      let body;
      try {
        const buf = Buffer.alloc(32768);
        const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
        body = buf.toString("utf8", 0, bytes);
      } finally { fs.closeSync(fd); }
      const names = symbols(f, body);
      if (!names.length) continue;
      const line = f.replace(/\\/g, "/") + ": " + names.slice(0, 6).join(", ");
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    } catch { /* unresolvable file or permission error: skip */ }
    if (lines.length >= 12) break;
  }
  return lines.length
    ? "# Existing code candidates (verify before reuse; not a complete index)\n" + lines.join("\n")
    : "";
}
module.exports = { leanPlan, codebaseMap, symbols };
