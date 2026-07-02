#!/usr/bin/env node
/**
 * fxmind gate-guard — Cursor preToolUse hook.
 *
 * Enforces fxmind Task-mode Gates A & B before code edits.
 *
 * Source of truth: .fxmind/fxmind-gates.json:
 *   { "taskActive": true, "gates": { "A": {"complete": true}, "B": {...}, "C": {...} } }
 *
 * The /fxmind task flow (or fxmind_record_gate MCP tool) writes this file.
 * When taskActive is false, the hook allows everything (no fxmind task running).
 * When taskActive is true, code edits (files outside the fxmind/config allowlist)
 * require Gates A and B to be complete; otherwise it asks the user to confirm.
 *
 * Fail-open: any parse/IO error → allow (returns permission allow).
 */
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.cwd();
const GATES_FILE = path.join(PROJECT_ROOT, ".fxmind", "fxmind-gates.json");
const LEGACY_GATES_FILE = path.join(PROJECT_ROOT, ".fxmind-gates.json");

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

const ALLOW_EXACT = new Set([
  "reference.mdc",
  ".gitignore",
  "package.json",
  "package-lock.json",
]);

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

function migrateLegacyGates() {
  if (fs.existsSync(GATES_FILE) || !fs.existsSync(LEGACY_GATES_FILE)) {
    return;
  }
  fs.mkdirSync(path.dirname(GATES_FILE), { recursive: true });
  fs.copyFileSync(LEGACY_GATES_FILE, GATES_FILE);
  fs.unlinkSync(LEGACY_GATES_FILE);
}

function readGates() {
  try {
    migrateLegacyGates();
    if (!fs.existsSync(GATES_FILE)) return null;
    return JSON.parse(fs.readFileSync(GATES_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isCodeFile(filePath) {
  if (!filePath) return false;
  const rel = path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, filePath)).replace(/\\/g, "/");
  if (ALLOW_EXACT.has(rel)) return false;
  for (const prefix of ALLOW_PREFIXES) {
    if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) return false;
  }
  return true;
}

function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

function ask(userMessage, agentMessage) {
  process.stdout.write(
    JSON.stringify({
      permission: "ask",
      user_message: userMessage,
      agent_message: agentMessage,
    }),
  );
  process.exit(0);
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    allow();
  }

  const toolName = input.tool_name || input.tool || "";
  const toolInput = input.tool_input || input.input || {};
  const filePath = toolInput.file_path || toolInput.path || toolInput.filePath || "";

  // Only gate file-writing tools. Everything else allowed.
  const editTools = /^(Edit|Write|StrReplace|FileEdit|MultiEdit|NotebookEdit)$/i;
  if (!editTools.test(toolName)) {
    allow();
  }

  // Non-code files (memories, config, gates file) are always allowed.
  if (!isCodeFile(filePath)) {
    allow();
  }

  const gates = readGates();
  if (!gates || !gates.taskActive) {
    allow();
  }

  const a = gates.gates && gates.gates.A && gates.gates.A.complete;
  const b = gates.gates && gates.gates.B && gates.gates.B.complete;

  if (a && b) {
    allow();
  }

  const missing = [];
  if (!a) missing.push("A");
  if (!b) missing.push("B");

  const warnOnly = process.env.FXMIND_GATE_WARN;
  if (warnOnly && warnOnly !== "0" && warnOnly.toLowerCase() !== "false") {
    process.stderr.write(
      `fxmind gate-guard (warn-only): code edit before Gate${missing.length > 1 ? "s" : ""} ${missing.join(" & ")} — complete the /fxmind task Gate ${missing.join(" then ")} step. Edit allowed under FXMIND_GATE_WARN.\n`,
    );
    allow();
  }

  ask(
    `fxmind: code edit blocked — Gate${missing.length > 1 ? "s" : ""} ${missing.join(" & ")} not recorded. Complete the analysis + memory load (🛑 GATE ${missing.join(" / ")} COMPLETE) before editing code.`,
    `A fxmind task is active but Gate ${missing.join(" and ")} marker${missing.length > 1 ? "s are" : " is"} not in .fxmind/fxmind-gates.json. Run the Gate ${missing.join(" then ")} step of /fxmind task (output the 🛑 GATE marker and record it via fxmind_record_gate or by writing .fxmind/fxmind-gates.json) before editing ${filePath || "code"}.`,
  );
}

main().catch(() => allow());
