#!/usr/bin/env node
/**
 * fxmind gate-guard — Cursor preToolUse hook.
 *
 * Enforces fxmind Task-mode Gates A & B before code edits.
 * With 2+ parallel sessions, requires fxmind_claim_paths before code edits.
 *
 * Fail-open: any parse/IO error → allow.
 */
const fs = require("fs");
const path = require("path");
const { writeLocal, fxmindDir } = require("./lib/layout.js");
const taskSessions = require("./lib/task-sessions.js");

const PROJECT_ROOT = process.cwd();
const GATES_FILE = writeLocal(PROJECT_ROOT, "gates");
const V2_GATES_FILE = path.join(fxmindDir(PROJECT_ROOT), "fxmind-gates.json");
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
  if (fs.existsSync(GATES_FILE)) {
    return;
  }
  const source = fs.existsSync(V2_GATES_FILE)
    ? V2_GATES_FILE
    : fs.existsSync(LEGACY_GATES_FILE)
      ? LEGACY_GATES_FILE
      : null;
  if (!source) {
    return;
  }
  fs.mkdirSync(path.dirname(GATES_FILE), { recursive: true });
  fs.copyFileSync(source, GATES_FILE);
  fs.unlinkSync(source);
}

function readLegacyGates() {
  try {
    migrateLegacyGates();
    if (!fs.existsSync(GATES_FILE)) return null;
    return JSON.parse(fs.readFileSync(GATES_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeLegacyGates(data) {
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
    rel === ".fxmind/state/fxmind-gates.json" ||
    rel.startsWith(".fxmind/state/sessions/") ||
    rel === ".fxmind/state/sessions.json" ||
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
  const payload = taskSessions.startSession(PROJECT_ROOT, { autoStarted: true });
  return payload;
}

function hookConversationId(input) {
  return (
    input.conversation_id ||
    input.conversationId ||
    input.composer_id ||
    input.composerId ||
    input.session_id ||
    input.sessionId ||
    null
  );
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

  if (isGatesFile(filePath)) {
    ask(
      "fxmind: do not edit session/gates JSON directly — use MCP fxmind_start_task / fxmind_record_gate.",
      "Blocked: gates are session state managed by Node. Call MCP fxmind_start_task then fxmind_record_gate for A/B/V/C.",
    );
  }

  if (!isCodeFile(filePath)) {
    allow();
  }

  const rel = toRel(filePath);
  const multi = taskSessions.multiSessionMode(PROJECT_ROOT);
  let hookResult;
  try {
    hookResult = taskSessions.gatesForHook(PROJECT_ROOT, {
      filePath: rel,
      conversationId: hookConversationId(input),
      sessionId: process.env.FXMIND_SESSION_ID || null,
    });
  } catch {
    hookResult = null;
  }

  if (hookResult && hookResult.allow === false) {
    ask(`fxmind: ${hookResult.message}`, hookResult.message);
  }

  let gates = hookResult?.session || readLegacyGates();
  if (!gates || !gates.taskActive) {
    if (multi) {
      ask(
        "fxmind: parallel sessions — call fxmind_start_task before editing code.",
        "Multiple Task sessions are active in this repo. Call MCP fxmind_start_task, complete Gates A & B, fxmind_claim_paths for files you will edit, then retry.",
      );
    }
    if (!autoTaskEnabled()) {
      allow();
    }
    try {
      gates = startAutoTask();
    } catch {
      allow();
    }
    ask(
      "fxmind: Task auto-started — enable MCP fxmind if needed, then complete Gates A & B before editing code.",
      `Code edit blocked: Task mode auto-started for ${filePath || "this file"}. Call fxmind_start_task / fxmind_record_gate (A then B). Then retry the edit.`,
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
    `Task active but Gate ${missing.join(" and ")} missing. Call fxmind_record_gate with gate="${missing[0]}"${missing[1] ? ` then gate="${missing[1]}"` : ""}. Then retry editing ${filePath || "code"}.`,
  );
}

main().catch(() => allow());
