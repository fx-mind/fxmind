#!/usr/bin/env node
/**
 * fxmind drift-watcher — Cursor postToolUse hook (after file edits).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { isCodeFile, driftForFile } = require("./lib/memory-drift.js");

const PROJECT_ROOT = process.cwd();
const FXMIND_DIR = path.join(PROJECT_ROOT, ".fxmind");
const DRIFT_LOG = path.join(FXMIND_DIR, "drift.json");
const GRAPH_PENDING = path.join(FXMIND_DIR, ".graph-pending");

function autoRebuildGraph() {
  const disable =
    process.env.FXMIND_GRAPH_NO_AUTO &&
    process.env.FXMIND_GRAPH_NO_AUTO !== "0" &&
    process.env.FXMIND_GRAPH_NO_AUTO.toLowerCase() !== "false";
  if (disable) return false;

  try {
    fs.writeFileSync(GRAPH_PENDING, new Date().toISOString(), "utf8");
  } catch {
    // ignore
  }

  const bin = process.env.FXMIND_BIN || "fxmind";
  let child;
  try {
    child = spawn(
      bin,
      ["graph", "--no-open"],
      { cwd: PROJECT_ROOT, detached: true, stdio: "ignore", shell: true },
    );
  } catch {
    return false;
  }
  if (child && typeof child.unref === "function") {
    child.unref();
  }
  return true;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let resolved = false;
    const finish = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => finish(data));
    if (process.stdin.isTTY) finish("");
  });
}

function appendDriftLog(entry) {
  let log = [];
  try {
    if (fs.existsSync(DRIFT_LOG)) log = JSON.parse(fs.readFileSync(DRIFT_LOG, "utf8")) || [];
  } catch {
    log = [];
  }
  log.push(entry);
  if (log.length > 50) log = log.slice(-50);
  try {
    fs.mkdirSync(FXMIND_DIR, { recursive: true });
    fs.writeFileSync(DRIFT_LOG, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  } catch {
    // best-effort
  }
}

function emit(context) {
  process.stdout.write(JSON.stringify({ additional_context: context }));
  process.exit(0);
}

function noop() {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    noop();
  }

  const toolName = input.tool_name || input.tool || "";
  const toolInput = input.tool_input || input.input || {};
  const filePath = toolInput.file_path || toolInput.path || toolInput.filePath || "";

  const editTools = /^(Edit|Write|StrReplace|FileEdit|MultiEdit|NotebookEdit)$/i;
  if (!editTools.test(toolName) || !filePath) {
    noop();
  }

  const rel = path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, filePath)).replace(/\\/g, "/");

  if (rel.startsWith(".fxmind/memory/") && rel.endsWith(".md")) {
    const rebuilt = autoRebuildGraph();
    emit(
      rebuilt
        ? `fxmind: memory file ${rel} edited — rebuilding knowledge-graph.json in the background via \`fxmind graph\`. Run /fxmind query or reopen the 3D map to use it.`
        : `fxmind: memory file ${rel} was edited. Run \`fxmind graph\` (or /fxmind graph) to rebuild the 3D knowledge map and knowledge-graph.json.`,
    );
  }

  if (!isCodeFile(rel)) {
    noop();
  }

  const result = driftForFile(PROJECT_ROOT, rel);
  if (result.hits.length === 0) {
    noop();
  }

  appendDriftLog({ at: new Date().toISOString(), ...result });

  const broken = result.hits.filter((h) => h.verdict === "broken");
  const stale = result.hits.filter((h) => h.verdict === "stale-candidate");
  const lines = [
    `fxmind drift: ${rel} (${result.fileExists ? "still present" : "missing"}) affects ${result.hits.length} memor${result.hits.length === 1 ? "y" : "ies"}.`,
  ];
  for (const h of broken) {
    lines.push(`  • BROKEN: ${h.memoryFile} references ${h.referencedPath} (file gone) — re-run /fxmind learn ${h.slug}`);
  }
  for (const h of stale) {
    lines.push(`  • STALE:  ${h.memoryFile} references ${h.referencedPath} — consider /fxmind learn ${h.slug}`);
  }
  emit(lines.join("\n"));
}

main().catch(() => noop());
