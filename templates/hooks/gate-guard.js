#!/usr/bin/env node
/**
 * fxmind gate-guard — Cursor preToolUse hook.
 *
 * Enforces fxmind Task-mode Gates A & B before code edits.
 * Gates are session state — agents must use MCP fxmind_record_gate / fxmind_start_task
 * (never Write the gates JSON directly).
 *
 * Auto-start (default): first code edit without an active task starts Task mode.
 * Disable with FXMIND_AUTO_TASK=0.
 *
 * Fail-open: any parse/IO error → allow.
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

function writeGates(data) {
  fs.mkdirSync(path.dirname(GATES_FILE), { recursive: true });
  fs.writeFileSync(GATES_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function autoTaskEnabled() {
  const value = process.env.FXMIND_AUTO_TASK;
  if (value === undefined || value === "") return true;
  return value !== "0" && value.toLowerCase() !== "false" && value.toLowerCase() !== "off";
}

function toRel(filePath) {
  if (!filePath) return "";
  return path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, filePath)).replace(/\\/g, "/");
}

function isGatesFile(filePath) {
  const rel = toRel(filePath);
  return (
    rel === ".fxmind/fxmind-gates.json" ||
    rel === ".fxmind-gates.json" ||
    rel.endsWith("/fxmind-gates.json")
  );
}

function isCodeFile(filePath) {
  if (!filePath) return false;
  const rel = toRel(filePath);
  if (isGatesFile(filePath)) return false;
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

function startAutoTask() {
  const payload = {
    schemaVersion: 1,
    taskActive: true,
    autoStarted: true,
    session: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    gates: {},
  };
  writeGates(payload);
  return payload;
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

  const editTools = /^(Edit|Write|StrReplace|FileEdit|MultiEdit|NotebookEdit)$/i;
  if (!editTools.test(toolName)) {
    allow();
  }

  // Gates JSON is MCP/CLI-only — block agent Write/Edit.
  if (isGatesFile(filePath)) {
    ask(
      "fxmind: do not edit fxmind-gates.json directly — use the MCP tool fxmind_record_gate.",
      "Blocked: gates are session state managed by Node. Call MCP fxmind_start_task (or fxmind_record_gate with gate=START) then fxmind_record_gate for A/B/C. Do not Write/Edit .fxmind/fxmind-gates.json.",
    );
  }

  if (!isCodeFile(filePath)) {
    allow();
  }

  let gates = readGates();
  if (!gates || !gates.taskActive) {
    if (!autoTaskEnabled()) {
      allow();
    }
    try {
      gates = startAutoTask();
    } catch {
      allow();
    }
    ask(
      "fxmind: Task auto-started — complete Gates A & B via MCP before editing code.",
      `Code edit blocked: Task mode auto-started for ${filePath || "this file"}. Read .fxmind/modes/task.md. Call fxmind_record_gate (A then B) — never write the gates JSON. Then retry the edit.`,
    );
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
      `fxmind gate-guard (warn-only): code edit before Gate${missing.length > 1 ? "s" : ""} ${missing.join(" & ")}. Edit allowed under FXMIND_GATE_WARN.\n`,
    );
    allow();
  }

  ask(
    `fxmind: code edit blocked — Gate${missing.length > 1 ? "s" : ""} ${missing.join(" & ")} not recorded. Use MCP fxmind_record_gate.`,
    `Task active but Gate ${missing.join(" and ")} missing. Call fxmind_record_gate with gate="${missing[0]}"${missing[1] ? ` then gate="${missing[1]}"` : ""} (output 🛑 GATE markers in chat too). Do not Write .fxmind/fxmind-gates.json. Then retry editing ${filePath || "code"}.`,
  );
}

main().catch(() => allow());
