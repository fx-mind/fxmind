#!/usr/bin/env node
"use strict";
/**
 * Cursor/FxMind hard prerequisite:
 * Until FxMind MCP successfully returns project memory, deny every unrelated
 * tool, shell execution, file read and non-FxMind MCP operation.
 *
 * Never fail open because of missing conversation_id, exhausted retries,
 * wrong CWD, absent state, missing MCP or a corrupted state file.
 * Use one per-workspace checkpoint (Cursor's tool events have no stable session
 * id). beforeSubmitPrompt always resets the checkpoint for the next turn.
 *
 * Project hooks are a workflow guard, NOT a security sandbox. Cursor clients
 * that never execute project hooks cannot be intercepted by this script.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const READ_TOOLS = new Set(["fxmind_query", "fxmind_read_file", "fxmind_search", "fxmind_playbook"]);
const FAILURE = "FXMIND OBRIGATORIO: consulta bem-sucedida de memoria pelo MCP fxmind pendente. Nao execute Grep, terminal, leitura, edicao, subagentes ou outras ferramentas. Chame fxmind_query agora. Se o MCP falhar, informe o bloqueio e pare; nao use fallback.";

function projectRoot(input = {}, env = process.env) {
  // The installed hook itself is an authoritative workspace locator, even if
  // Cursor launches Node from C:\\Windows\\System32 or another directory.
  const sources = [path.resolve(__dirname, "..", ".."), env.FXMIND_TARGET, process.cwd(), input.cwd, input.working_directory];
  if (typeof input?.tool_input === "object") sources.push(input.tool_input.working_directory);
  for (const raw of sources) {
    if (!raw || typeof raw !== "string") continue;
    let dir = path.resolve(raw);
    while (true) {
      if (fs.existsSync(path.join(dir, ".fxmind", "memory")) &&
          fs.existsSync(path.join(dir, ".cursor", "hooks.json"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
function statePath(root) {
  const hash = crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 24);
  return path.join(root, ".fxmind", "state", "cursor-memory-first", hash + ".json");
}
function load(root) {
  if (!root) return null;
  try {
    const s = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
    // Do not trust stale state, future timestamps or missing data.
    if (!s || s.version !== 3 || s.consulted !== true || !Number.isFinite(s.at) ||
        s.at > Date.now() + 1000 || Date.now() - s.at > 15 * 60 * 1000) return null;
    return s;
  } catch { return null; }
}
function save(root, consulted) {
  if (!root) throw new Error("Workspace FxMind nao identificado");
  const file = statePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + ".tmp";
  const data = JSON.stringify({ version: 3, consulted: !!consulted, at: Date.now() });
  try {
    fs.writeFileSync(temporary, data, "utf8");
    try {
      fs.renameSync(temporary, file);
    } catch (renameError) {
      // Windows/antivirus or simultaneous Cursor events can briefly lock the
      // destination. A direct write is the bounded fallback for that race.
      fs.writeFileSync(file, data, "utf8");
    }
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}
function nameOf(input) {
  return String(input?.tool_name || "");
}
function isFxMindTool(name) {
  // Only memory retrieval may run before FxMind context is loaded.
  // Cursor preToolUse names MCP calls as MCP:<tool_name>.
  return /^MCP:fxmind_(?:query|read_file|search|playbook)$/.test(name) ||
    /^mcp__fxmind__fxmind_(?:query|read_file|search|playbook)$/.test(name);
}
function isFxMindMcpRead(name) {
  return READ_TOOLS.has(name.replace(/^MCP:/, "").replace(/^mcp__fxmind__/, ""));
}
function memoryReadSucceeded(input) {
  if (String(input?.mcp_server_name || "").toLowerCase() !== "fxmind") return false;
  const name = nameOf(input).replace(/^MCP:/, "").replace(/^mcp__fxmind__/, "");
  if (!READ_TOOLS.has(name)) return false;
  let result = input.result_json;
  if (result == null) return false;
  try { if (typeof result === "string") result = JSON.parse(result); } catch { return false; }
  if (!result || typeof result !== "object" || result.isError === true ||
      result.error != null || result.ok === false) return false;
  const content = result.content;
  // Require actual returned context, not merely a 200/empty result.
  if (Array.isArray(content)) {
    return content.some((item) => item && item.type === "text" &&
      typeof item.text === "string" && item.text.trim().length > 0 &&
      !/^(error|erro|falha)\s*:/i.test(item.text.trim()));
  }
  // Some MCP implementations wrap JSON in result_json.result.
  if (result.result && Array.isArray(result.result.content)) {
    return result.result.content.some((item) => typeof item?.text === "string" && item.text.trim().length > 0);
  }
  return false;
}
function deny() {
  return { permission: "deny", user_message: FAILURE, agent_message: FAILURE };
}
function run(event, input = {}, env = process.env) {
  const root = projectRoot(input, env);
  switch (event) {
    case "sessionStart":
      // Never prevent the assistant from starting; tool hooks still fail closed.
      if (root) try { save(root, false); } catch (err) { reportError("sessionStart", err); }
      return { additional_context: FAILURE };
    case "beforeSubmitPrompt":
      // Sending the prompt must ALWAYS be allowed; otherwise the agent cannot
      // even call FXMIND. A failed reset leaves the tool gate locked.
      if (root) try { save(root, false); } catch (err) { reportError("beforeSubmitPrompt", err); }
      return { continue: true };
    case "afterMCPExecution":
      if (root && memoryReadSucceeded(input)) {
        try { save(root, true); } catch (err) { reportError("afterMCPExecution", err); }
      }
      return {};
    case "preToolUse":
      if (isFxMindTool(nameOf(input))) return { permission: "allow" };
      return load(root) ? { permission: "allow" } : deny();
    case "beforeMCPExecution":
      if (String(input.mcp_server_name || "").toLowerCase() === "fxmind" &&
          isFxMindMcpRead(nameOf(input))) return { permission: "allow" };
      return load(root) ? { permission: "allow" } : deny();
    case "beforeShellExecution":
    case "beforeReadFile":
      return load(root) ? { permission: "allow" } : deny();
    default:
      return {};
  }
}
function reportError(event, err) {
  // Diagnostic contains no prompts, tool inputs, credentials, or MCP results.
  const code = String(err?.code || err?.name || "unknown").slice(0, 50);
  try { process.stderr.write("[fxmind-hook] " + event + " state error: " + code + "\\n"); } catch {}
}
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { if (buffer.length < 100000) buffer += chunk; });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", () => resolve(""));
  });
}
if (require.main === module) {
  (async () => {
    const raw = await readStdin();
    const input = JSON.parse(raw || "{}");
    const event = String(input.hook_event_name || process.argv[2] || "");
    process.stdout.write(JSON.stringify(run(event, input)));
  })().catch((err) => {
    const event = String(process.argv[2] || "");
    reportError(event, err);
    // A broken prompt hook must not stop the agent from attempting FXMIND.
    // Tools remain denied until the successful MCP result is persisted.
    if (event === "beforeSubmitPrompt") {
      process.stdout.write(JSON.stringify({ continue: true }));
    } else if (event === "sessionStart") {
      process.stdout.write(JSON.stringify({ additional_context: FAILURE }));
    } else if (event === "afterMCPExecution") {
      process.stdout.write("{}");
    } else {
      process.stdout.write(JSON.stringify(deny()));
    }
  });
}
module.exports = { run, projectRoot, load, save, memoryReadSucceeded, isFxMindTool };
