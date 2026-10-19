"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../../templates/hooks/memory-first.js");
let dir;
function event(hookEvent, payload = {}, env = {}) {
  const input = { conversation_id: "cursor-test-session", ...payload, hook_event_name: hookEvent };
  const output = spawnSync(process.execPath, [script, hookEvent], {
    cwd: dir, input: JSON.stringify(input), encoding: "utf8",
    env: { ...process.env, FXMIND_MEMORY_FIRST: "1", ...env },
    timeout: 4000,
  });
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}
describe("Cursor FxMind memory-first routing", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-cursor-routing-"));
    fs.mkdirSync(path.join(dir, ".fxmind", "memory"), { recursive: true });
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("suggests the MCP order at session start without blocking the user", () => {
    assert.match(event("sessionStart").additional_context, /fxmind_query/);
    assert.equal(event("beforeSubmitPrompt", { prompt: "qual o webhook de contratacao?" }).continue, true);
  });
  it("redirects only the first premature Grep each turn, then permits fallback", () => {
    event("beforeSubmitPrompt", { prompt: "qual o webhook de contratacao?" });
    const grep = { tool_name: "Grep", tool_input: { pattern: "contratacao" } };
    assert.equal(event("preToolUse", grep).permission, "deny");
    assert.match(event("preToolUse", grep).permission, /allow/);
    event("beforeSubmitPrompt", { prompt: "outra pergunta" });
    assert.equal(event("preToolUse", grep).permission, "deny");
  });
  it("allows Grep after successful FxMind query and does not miscount other MCP servers", () => {
    event("beforeSubmitPrompt");
    event("afterMCPExecution", { mcp_server_name: "other", tool_name: "fxmind_query", result_json: "{}" });
    assert.equal(event("preToolUse", { tool_name: "Grep" }).permission, "deny");
    event("beforeSubmitPrompt");
    event("afterMCPExecution", {
      mcp_server_name: "fxmind", tool_name: "fxmind_query", result_json: '{"content":[{"type":"text","text":"# painel"}]}',
    });
    assert.equal(event("preToolUse", { tool_name: "Grep" }).permission, "allow");
  });
  it("does not count a failed FxMind MCP query as successful", () => {
    event("beforeSubmitPrompt");
    event("afterMCPExecution", { mcp_server_name: "fxmind", tool_name: "fxmind_query", result_json: '{"isError":true}' });
    assert.equal(event("preToolUse", { tool_name: "Grep" }).permission, "deny");
  });
  it("intercepts shell search commands but leaves builds and normal reads alone", () => {
    event("beforeSubmitPrompt");
    assert.equal(event("preToolUse", { tool_name: "Shell", tool_input: { command: "npm test" } }).permission, "allow");
    assert.equal(event("preToolUse", { tool_name: "Read", tool_input: { path: "core.lua" } }).permission, "allow");
    assert.equal(event("preToolUse", { tool_name: "Shell", tool_input: { command: "rg -n contratacao resources" } }).permission, "deny");
    assert.equal(event("preToolUse", { tool_name: "Shell", tool_input: { command: "rg -n contratacao resources" } }).permission, "allow");
  });
  it("fails open without conversation ID, workspace memory or when disabled", () => {
    assert.equal(event("preToolUse", { tool_name: "Grep", conversation_id: "" }).permission, "allow");
    assert.equal(event("preToolUse", { tool_name: "Grep" }, { FXMIND_MEMORY_FIRST: "0" }).permission, "allow");
    fs.rmSync(path.join(dir, ".fxmind", "memory"), { recursive: true });
    assert.equal(event("preToolUse", { tool_name: "Grep" }).permission, "allow");
  });
  it("does not store user prompts or tool input in per-turn state", () => {
    event("beforeSubmitPrompt", { prompt: "token_secret_superprivate" });
    const files = fs.readdirSync(path.join(dir, ".fxmind", "state", "cursor-memory-first"));
    const body = fs.readFileSync(path.join(dir, ".fxmind", "state", "cursor-memory-first", files[0]), "utf8");
    assert.doesNotMatch(body, /token_secret_superprivate/);
  });
});
