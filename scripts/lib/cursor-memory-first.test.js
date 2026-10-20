"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { installHooks } = require("../hooks");
const script = path.resolve(__dirname, "../../templates/hooks/memory-first.js");
let dir;
function event(hookEvent, payload = {}, env = {}) {
  // Intentionally use Cursor's documented payload without conversation_id:
  // the old implementation silently allowed Grep when session IDs were missing.
  const input = { ...payload, hook_event_name: hookEvent };
  const output = spawnSync(process.execPath, [script, hookEvent], {
    cwd: dir, input: JSON.stringify(input), encoding: "utf8",
    env: { ...process.env, FXMIND_MEMORY_FIRST: "1", CURSOR_SESSION_ID: "", ...env },
    timeout: 4000,
  });
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}
describe("Cursor memory-first hooks with real Cursor payloads", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-cursor-routing-"));
    fs.mkdirSync(path.join(dir, ".fxmind", "memory"), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("injects context and starts a new turn without an ID", () => {
    assert.match(event("sessionStart", { session_id: "new-composer" }).additional_context, /fxmind_query/);
    assert.equal(event("beforeSubmitPrompt", { prompt: "linkar flyers" }).continue, true);
  });
  it("redirects premature Grep with no conversation_id (regression)", () => {
    event("beforeSubmitPrompt", { prompt: "linkar flyers" });
    const grep = { tool_name: "Grep", tool_input: { pattern: "outubrorosa" } };
    assert.equal(event("preToolUse", grep).permission, "deny");
    assert.equal(event("preToolUse", grep).permission, "deny");
    assert.equal(event("preToolUse", grep).permission, "allow");
    event("beforeSubmitPrompt", { prompt: "new turn" });
    assert.equal(event("preToolUse", grep).permission, "deny");
  });
  it("handles beforeShellExecution without any tool_name", () => {
    event("beforeSubmitPrompt");
    assert.equal(event("beforeShellExecution", { command: 'rg -n "outubrorosa" .' }).permission, "deny");
    assert.equal(event("beforeShellExecution", { command: 'git grep -n "card"' }).permission, "deny");
    assert.equal(event("beforeShellExecution", { command: "npm test" }).permission, "allow");
  });
  it("does not count other MCP servers or errored tool responses", () => {
    event("beforeSubmitPrompt");
    event("afterMCPExecution", { mcp_server_name: "other", tool_name: "fxmind_query", result_json: "{}" });
    event("afterMCPExecution", { mcp_server_name: "fxmind", tool_name: "fxmind_query", result_json: '{"isError":true}' });
    assert.equal(event("preToolUse", { tool_name: "Grep" }).permission, "deny");
    event("afterMCPExecution", {
      mcp_server_name: "fxmind", tool_name: "fxmind_query",
      result_json: '{"content":[{"type":"text","text":"indexed memory: inventory"}]}',
    });
    assert.equal(event("preToolUse", { tool_name: "Grep" }).permission, "allow");
  });
  it("recognizes FxMind MCP tool results with tool prefix", () => {
    event("beforeSubmitPrompt");
    event("afterMCPExecution", { mcp_server_name: "fxmind", tool_name: "MCP:fxmind_search", result_json: "{}" });
    assert.equal(event("preToolUse", { tool_name: "Glob" }).permission, "allow");
  });
  it("does not gate known-file reads, shell tests, or normal edits", () => {
    event("beforeSubmitPrompt");
    for (const payload of [
      { tool_name: "Read", tool_input: { path: ".fxmind/modes/task.md" } },
      { tool_name: "Shell", tool_input: { command: "luac -p main.lua" } },
      { tool_name: "Write", tool_input: { path: "main.lua" } },
    ]) assert.equal(event("preToolUse", payload).permission, "allow");
  });
  it("allows fallback without infinite retry and can be disabled", () => {
    event("beforeSubmitPrompt");
    const grep = { tool_name: "Grep" };
    assert.equal(event("preToolUse", grep).permission, "deny");
    assert.equal(event("preToolUse", grep).permission, "deny");
    assert.equal(event("preToolUse", grep).permission, "allow");
    assert.equal(event("preToolUse", grep, { FXMIND_MEMORY_FIRST: "0" }).permission, "allow");
  });
  it("fails open when FxMind memory is not installed", () => {
    fs.rmSync(path.join(dir, ".fxmind", "memory"), { recursive: true });
    assert.equal(event("preToolUse", { tool_name: "Grep" }).permission, "allow");
  });
  it("saves no user prompts, patterns, or secrets to local state", () => {
    event("beforeSubmitPrompt", { prompt: "secret-value-123" });
    event("preToolUse", { tool_name: "Grep", tool_input: { pattern: "secret-pattern-456" } });
    const stateDir = path.join(dir, ".fxmind", "state", "cursor-memory-first");
    const body = fs.readFileSync(path.join(stateDir, fs.readdirSync(stateDir)[0]), "utf8");
    assert.doesNotMatch(body, /secret-value-123|secret-pattern-456/);
  });
  it("installer replaces blanket FxMind cursorignore and wires shell hook", () => {
    fs.writeFileSync(path.join(dir, ".cursorignore"), "cache\n.fxmind/*\nnode_modules\n");
    installHooks(dir, { gitHook: false });
    const ignore = fs.readFileSync(path.join(dir, ".cursorignore"), "utf8");
    assert.doesNotMatch(ignore, /^\.fxmind\/\*$/m);
    assert.match(ignore, /^\.fxmind\/state\/$/m);
    assert.match(ignore, /^node_modules$/m);
    const hooks = JSON.parse(fs.readFileSync(path.join(dir, ".cursor", "hooks.json"), "utf8")).hooks;
    assert.ok(hooks.beforeShellExecution.some((x) => x.command.includes("memory-first.js")));
    assert.ok(hooks.preToolUse.some((x) => x.command.includes("memory-first.js")));
  });
});
