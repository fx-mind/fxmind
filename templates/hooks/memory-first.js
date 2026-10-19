#!/usr/bin/env node
"use strict";
/**
 * Cursor memory-first routing for FxMind workspaces.
 *
 * Session start adds a routing hint; beforeSubmitPrompt resets per-turn state;
 * afterMCPExecution records an actual FxMind lookup; preToolUse redirects the
 * FIRST premature Grep/Shell search in each turn to FxMind.
 *
 * Never blocks more than once per turn (or one time on an older session).
 * This is a discoverability nudge, not a security boundary. If FxMind MCP is
 * disabled/unavailable, native search is allowed on the retry.
 *
 * Stores only booleans and timestamps in ignored .fxmind/state/, no prompts,
 * tool inputs, search patterns, or secret values.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = process.cwd();
const memoryDir = path.join(root, ".fxmind", "memory");
const stateDir = path.join(root, ".fxmind", "state", "cursor-memory-first");

const SEARCH_COMMAND = /(?:^|[\s;&|("'])(?:rg|grep|git\s+grep|findstr|Select-String|ack|ag)(?=\s|$)/i;
const SEARCH_PIPE = /\|\s*(?:Select-String|grep|rg)(?=\s|$)/i;
const LOOKUP_NAMES = new Set(["fxmind_query", "fxmind_search", "fxmind_playbook", "fxmind_read_file"]);

function active(env = process.env) {
  return env.FXMIND_MEMORY_FIRST !== "0" && env.FXMIND_MEMORY_FIRST !== "false"
    && fs.existsSync(memoryDir);
}

function conversationId(input) {
  const raw = input.conversation_id || input.session_id || input.composer_id || input.conversationId || input.sessionId;
  return typeof raw === "string" && raw.length > 0 && raw.length < 512 ? raw : "";
}

function stateFile(input) {
  const id = conversationId(input);
  if (!id) return null;
  const hash = crypto.createHash("sha256").update(id).digest("hex").slice(0, 24);
  return path.join(stateDir, hash + ".json");
}

function readState(input) {
  const file = stateFile(input);
  if (!file) return null;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!state || typeof state !== "object" || Date.now() - state.at > 6 * 60 * 60 * 1000) return null;
    return state;
  } catch {
    return null;
  }
}

function writeState(input, data) {
  const file = stateFile(input);
  if (!file) return;
  fs.mkdirSync(stateDir, { recursive: true });
  // Atomic replacement for hooks run concurrently across parallel tools.
  const temporary = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(data), "utf8");
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function isNativeSearch(input) {
  const name = String(input.tool_name || "");
  if (name === "Grep" || name === "Glob") return true;
  if (name !== "Shell") return false;
  const command = String(input.tool_input?.command || "");
  return SEARCH_COMMAND.test(command) || SEARCH_PIPE.test(command);
}

function lookupSucceeded(input) {
  const server = String(input.mcp_server_name || "");
  const name = String(input.tool_name || "");
  if (server !== "fxmind" || !LOOKUP_NAMES.has(name)) return false;
  const result = input.result_json;
  if (!result) return false;
  const text = typeof result === "string" ? result : JSON.stringify(result);
  // Error responses from MCP do not count as a successful lookup.
  if (/"isError"\s*:\s*true/.test(text)) return false;
  return true;
}

function run(event, input) {
  if (!active()) return event === "beforeSubmitPrompt" ? { continue: true } : { permission: "allow" };
  switch (event) {
    case "sessionStart":
      return {
        additional_context:
          "FxMind active for this workspace. For repository questions and code discovery, first call fxmind_query to load relevant indexed project memory. Then use fxmind_search for missing symbols/paths, and read the current source to verify. Native Grep is a fallback after FxMind, not the first discovery step. Do not expose webhook URLs or credentials.",
      };
    case "beforeSubmitPrompt":
      writeState(input, { at: Date.now(), consulted: false, warned: false });
      return { continue: true };
    case "afterMCPExecution":
      if (lookupSucceeded(input)) {
        const state = readState(input) || { at: Date.now(), consulted: false, warned: false };
        writeState(input, { ...state, consulted: true });
      }
      return {};
    case "preToolUse":
      if (!isNativeSearch(input) || !stateFile(input)) return { permission: "allow" };
      const state = readState(input) || { at: Date.now(), consulted: false, warned: false };
      if (state.consulted || state.warned) return { permission: "allow" };
      writeState(input, { ...state, warned: true });
      return {
        permission: "deny",
        user_message: "FxMind: consulta de memória ainda não realizada. A busca nativa será liberada se o MCP não estiver disponível.",
        agent_message: "Antes da primeira busca Grep/Shell neste pedido, consulte fxmind_query (a memória do repositório). Use fxmind_search para paths/símbolos ausentes e depois confirme no código atual. Se o MCP FxMind estiver indisponível, a busca nativa fica liberada na próxima tentativa.",
      };
    default:
      return { permission: "allow" };
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { if (data.length < 100000) data += c; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

if (require.main === module) {
  (async () => {
    const input = JSON.parse((await readStdin()) || "{}");
    const event = String(input.hook_event_name || process.argv[2] || "");
    process.stdout.write(JSON.stringify(run(event, input)));
  })().catch(() => {
    // Fail-open: never break user questions or code exploration if state I/O fails.
    process.stdout.write(JSON.stringify({ permission: "allow", continue: true }));
  });
}

module.exports = { run, isNativeSearch, lookupSucceeded, active };
