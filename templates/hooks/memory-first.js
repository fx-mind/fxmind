#!/usr/bin/env node
"use strict";
/**
 * Memory-first routing for Cursor agent tools.
 *
 * Cursor's per-tool and prompt hooks do NOT reliably provide session_id:
 * preToolUse, beforeShellExecution and afterMCPExecution documented payloads
 * have no session identifier. Use a workspace-scoped fallback, reset on each
 * prompt, rather than silently allowing all Grep calls.
 *
 * Redirect at most twice per prompt to avoid deadlocks when MCP is offline.
 * This is a discovery preference, not a security policy.
 * State contains counters only, never prompts, patterns, source or secrets.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = process.cwd();
const memoryDir = path.join(root, ".fxmind", "memory");
const stateDir = path.join(root, ".fxmind", "state", "cursor-memory-first");
const SEARCH = /(?:^|[\s;&|("'])(?:rg|grep|git\s+grep|findstr|Select-String|ack|ag)(?=\s|$)/i;
const LOOKUP = new Set(["fxmind_query", "fxmind_search", "fxmind_playbook", "fxmind_read_file"]);
const MAX_REDIRECTS = 2;

function active(env = process.env) {
  return !["0", "false", "off"].includes(String(env.FXMIND_MEMORY_FIRST || "").toLowerCase())
    && fs.existsSync(memoryDir);
}
function stateFile(input) {
  const id = input?.conversation_id || input?.session_id || input?.composer_id
    || input?.conversationId || input?.sessionId || process.env.CURSOR_SESSION_ID;
  const scope = typeof id === "string" && id.length > 0 && id.length < 512
    ? "session:" + id : "workspace:" + root.toLowerCase();
  const hash = crypto.createHash("sha256").update(scope).digest("hex").slice(0, 24);
  return path.join(stateDir, hash + ".json");
}
function readState(input) {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(input), "utf8"));
    if (!data || !Number.isFinite(data.at) || Date.now() - data.at > 10 * 60 * 1000) return null;
    return data;
  } catch { return null; }
}
function writeState(input, data) {
  const file = stateFile(input);
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}
function toolName(input) {
  return String(input?.tool_name || "").replace(/^MCP:/, "");
}
function nativeSearch(event, input) {
  if (event === "beforeShellExecution") return SEARCH.test(String(input?.command || ""));
  if (event !== "preToolUse") return false;
  const name = toolName(input);
  if (name === "Grep" || name === "Glob") return true;
  if (name !== "Shell") return false;
  const value = input?.tool_input;
  const command = typeof value === "string" ? value : String(value?.command || "");
  return SEARCH.test(command);
}
function lookupSucceeded(input) {
  const name = toolName(input);
  const server = String(input?.mcp_server_name || "");
  if (server !== "fxmind" || !LOOKUP.has(name)) return false;
  const result = input?.result_json;
  if (result == null) return false;
  const payload = typeof result === "string" ? result : JSON.stringify(result);
  // Both transport errors and structured FxMind errors must not count.
  if (/"isError"\s*:\s*true|\btoolError\b|\berror\s*:\s*"?MCP\b/i.test(payload)) return false;
  return true;
}
function run(event, input) {
  if (!active()) return event === "beforeSubmitPrompt" ? { continue: true } : { permission: "allow" };
  switch (event) {
    case "sessionStart":
      return { additional_context:
        "FxMind is available. For repository questions or implementations, call fxmind_query BEFORE Grep/rg. Use fxmind_search for missing paths and symbols, then read current source to verify. Read .fxmind/modes/task.md when editing code. If MCP is unavailable, explicitly state that and use native search as fallback." };
    case "beforeSubmitPrompt":
      writeState(input, { at: Date.now(), consulted: false, redirects: 0 });
      return { continue: true };
    case "afterMCPExecution":
      if (lookupSucceeded(input)) {
        const state = readState(input) || { at: Date.now(), consulted: false, redirects: 0 };
        writeState(input, { ...state, consulted: true });
      }
      return {};
    case "preToolUse":
    case "beforeShellExecution": {
      if (!nativeSearch(event, input)) return { permission: "allow" };
      const state = readState(input) || { at: Date.now(), consulted: false, redirects: 0 };
      if (state.consulted || state.redirects >= MAX_REDIRECTS) return { permission: "allow" };
      writeState(input, { ...state, redirects: state.redirects + 1 });
      return {
        permission: "deny",
        user_message: "FXMIND: consulta à memória necessária antes da busca por código.",
        agent_message: "Consulte fxmind_query agora (MCP fxmind), antes de Grep/rg/Glob. Depois use fxmind_search para localizar caminhos e confirme com leitura direta dos arquivos. Se fxmind não aparecer entre as ferramentas disponíveis, explique a indisponibilidade e utilize busca nativa no fallback. Não repita Grep ignorando o MCP.",
      };
    }
    default:
      return { permission: "allow" };
  }
}
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { if (data.length < 100000) data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}
if (require.main === module) {
  (async () => {
    const input = JSON.parse((await readStdin()) || "{}");
    const event = String(input.hook_event_name || process.argv[2] || "");
    process.stdout.write(JSON.stringify(run(event, input)));
  })().catch(() => process.stdout.write(JSON.stringify({ permission: "allow", continue: true })));
}
module.exports = { run, nativeSearch, lookupSucceeded, active, stateFile };
