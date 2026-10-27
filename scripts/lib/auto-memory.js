"use strict";
/**
 * Gate C automatic learning. Always persist source-verified *atomic* facts.
 * Optional Jev provides only a relevance recommendation and never receives
 * file paths, source text or symbols. No broad topic Markdown is created.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const atomic = require("./atomic-memory");
const { systemOne, jevConfig } = require("./jev");
const SKIP = new Set(["client", "server", "src", "scripts", "common", "shared", "system", "ui", "modules", "main", "core"]);
function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
function topicFor(files) {
  const names = files.map((file) => {
    const parts = file.replace(/\\/g, "/").split("/");
    const marker = parts.findIndex((v) => v === "resources");
    if (marker >= 0 && parts[marker + 2]) return slug(parts[marker + 2]);
    return slug(parts.length > 1 ? parts[0] : path.parse(file).name);
  }).filter((name) => name && !SKIP.has(name));
  if (!names.length) return null;
  const frequency = new Map();
  for (const name of names) frequency.set(name, (frequency.get(name) || 0) + 1);
  return [...frequency].sort((a, b) => b[1] - a[1])[0][0];
}
function reviewIsVerified(session) {
  if (session?.gates?.C?.complete !== true) return false;
  const gate = session?.gates?.V;
  return gate?.complete === true && gate?.snapshot && Object.keys(gate.snapshot).length &&
    gate.evidence?.independentReview?.verdict === "verified" &&
    Array.isArray(gate.evidence.checks) && gate.evidence.checks.length > 0 &&
    gate.evidence.checks.every((check) => check.status === "passed");
}
function verifiedFiles(root, session) {
  const snapshot = session.gates.V.snapshot;
  const files = Object.keys(snapshot);
  if (files.length > 12) return [];
  return files.filter((file) => {
    if (!/^resources\//.test(file) || file.includes("..") || !/[.](lua|js|ts|tsx|json|html|css)$/.test(file)) return false;
    const full = path.resolve(root, file);
    if (!full.startsWith(path.resolve(root) + path.sep)) return false;
    try {
      const stat = fs.statSync(full);
      return stat.isFile() && stat.size <= 1024 * 1024 &&
        crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex") === snapshot[file];
    } catch { return false; }
  });
}
function symbolsFromFiles(root, files) {
  const symbols = new Set();
  for (const file of files.slice(0, 8)) {
    const body = fs.readFileSync(path.join(root, file), "utf8");
    const re = /(?:RegisterNetEvent|AddEventHandler|RegisterCommand|Trigger(?:Server|Client)Event)\s*\(\s*["']([a-zA-Z_][\w:.-]{3,75})["']|(?:function\s+|local\s+function\s+)([a-zA-Z_][\w.:]{3,75})/g;
    let match;
    while ((match = re.exec(body)) && symbols.size < 12) symbols.add(match[1] || match[2]);
  }
  return [...symbols];
}
const QUESTION = {
  type: "choice",
  instructions: "Recommend whether a verified software change is important enough to highlight in durable work memory. Do not infer behavior beyond the supplied resource label and counts.",
  criteria: { save: "Reusable implementation or multiple-file verified pattern.", skip: "Routine or transient change." },
};
async function learnAfterGate(root, session, options = {}) {
  if (!reviewIsVerified(session)) return { status: "skipped", reason: "no_verified_gate_v" };
  const files = verifiedFiles(root, session);
  if (!files.length) return { status: "skipped", reason: "stale_or_unsupported_files" };
  const topic = topicFor(files);
  if (!topic) return { status: "skipped", reason: "no_topic" };

  // Gate V must match the current files; the graph retains only records whose
  // exact source digest still matches. Existing hand-written notes are untouched.
  let learned;
  try {
    atomic.buildAtomic(root);
    learned = atomic.learnVerifiedSnapshot(root, session, files);
  } catch (error) {
    return { status: "skipped", reason: "atomic_index_failed", topic, error: String(error.message || error) };
  }

  const result = {
    status: learned.status, topic, mode: "atomic", added: learned.added,
    files: files.length, symbols: symbolsFromFiles(root, files).length,
  };

  const config = options.config || jevConfig(options.env, options.packageRoot);
  if (config.enabled && config.memoryEnabled && config.apiKey) {
    try {
      const decision = await systemOne(
        { resource: topic, fileCount: files.length, taskKind: String(session.kind || "unknown").slice(0, 30) },
        { preserve: QUESTION },
        { ...options, config },
      );
      result.jevRecommendation = decision?.preserve?.choice || null;
    } catch { /* advisory, never blocks deterministic learning */ }
  }
  return result;
}
module.exports = { learnAfterGate, topicFor, reviewIsVerified, verifiedFiles, symbolsFromFiles };
