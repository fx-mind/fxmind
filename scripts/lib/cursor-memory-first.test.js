"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { installHooks, uninstallHooks } = require("../hooks");
const script = path.resolve(__dirname, "../../templates/hooks/memory-first.js");
let dir;
function event(hookEvent, payload = {}, options = {}) {
  const input = { ...payload, hook_event_name: hookEvent };
  const process = spawnSync(global.process.execPath, [script, hookEvent], {
    cwd: options.cwd || dir,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...global.process.env, CURSOR_SESSION_ID: "", FXMIND_TARGET: "", ...options.env },
    timeout: 4000,
  });
  assert.equal(process.status, 0, process.stderr || process.stdout);
  return JSON.parse(process.stdout);
}
function lookup(result = { content: [{ type: "text", text: "Project memory: inventory and flyers" }] }, extras = {}) {
  return event("afterMCPExecution", {
    mcp_server_name: "fxmind",
    tool_name: "fxmind_query",
    result_json: JSON.stringify(result),
    ...extras,
  });
}
function denied(name = "Grep") { return event("preToolUse", { tool_name: name }); }
describe("Cursor FxMind strict memory gate", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-cursor-strict-"));
    fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: {} }));
    fs.mkdirSync(path.join(dir, ".fxmind", "memory"), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("blocks Grep, Shell, Read, Write, Search, Task, subagents and unknown tools until FxMind", () => {
    assert.equal(event("beforeSubmitPrompt", { prompt: "find outubrorosa" }).continue, true);
    for (const name of ["Grep", "Glob", "Shell", "Read", "Write", "Delete", "Task", "Explore", "Search", "codebase_search", "mcp__other__tool"]) {
      assert.equal(denied(name).permission, "deny", name);
    }
  });
  it("never grants automatic fallback, even after many failed attempts", () => {
    event("beforeSubmitPrompt");
    for (let i = 0; i < 8; i++) {
      assert.equal(denied("Grep").permission, "deny");
      assert.equal(event("beforeShellExecution", { command: "grep flyer" }).permission, "deny");
      assert.equal(event("beforeReadFile", { file_path: "core.lua" }).permission, "deny");
    }
  });
  it("allows FxMind memory lookup but not other FxMind operations before the first read", () => {
    event("beforeSubmitPrompt");
    assert.equal(denied("MCP:fxmind_query").permission, "allow");
    assert.equal(denied("MCP:fxmind_read_file").permission, "allow");
    assert.equal(denied("MCP:fxmind_start_task").permission, "deny");
    assert.equal(denied("MCP:fxmind_record_gate").permission, "deny");
    assert.equal(event("beforeMCPExecution", { mcp_server_name: "fxmind", tool_name: "fxmind_query" }).permission, "allow");
    assert.equal(event("beforeMCPExecution", { mcp_server_name: "other", tool_name: "fxmind_query" }).permission, "deny");
    assert.equal(event("beforeMCPExecution", { mcp_server_name: "fxmind", tool_name: "fxmind_start_task" }).permission, "deny");
  });
  it("unblocks code tools only after an actual nonempty successful FxMind memory result", () => {
    event("beforeSubmitPrompt");
    assert.equal(denied("Read").permission, "deny");
    lookup();
    for (const name of ["Grep", "Read", "Shell", "Task", "Write", "Delete"]) {
      assert.equal(denied(name).permission, "allow", name);
    }
    assert.equal(event("beforeShellExecution", { command: "ls" }).permission, "allow");
    assert.equal(event("beforeReadFile", { file_path: "core.lua" }).permission, "allow");
  });
  it("rejects failed MCP, empty contents, wrong server, and errors", () => {
    const failures = [
      [{ isError: true, content: [{ type: "text", text: "error" }] }, {}],
      [{ content: [] }, {}],
      [{ content: [{ type: "text", text: "   " }] }, {}],
      [{ content: [{ type: "text", text: "Error: unavailable" }] }, {}],
      [{ ok: false, content: [{ type: "text", text: "oops" }] }, {}],
      [{ error: "not found", content: [{ type: "text", text: "oops" }] }, {}],
      [{ content: [{ type: "text", text: "foo" }] }, { mcp_server_name: "other" }],
      [{ content: [{ type: "text", text: "foo" }] }, { tool_name: "fxmind_start_task" }],
    ];
    for (const [data, props] of failures) {
      event("beforeSubmitPrompt");
      lookup(data, props);
      assert.equal(denied().permission, "deny", JSON.stringify([data, props]));
    }
  });
  it("does not reuse successful FxMind result across user turns", () => {
    event("beforeSubmitPrompt");
    lookup();
    assert.equal(denied("Grep").permission, "allow");
    event("beforeSubmitPrompt", { prompt: "next request" });
    assert.equal(denied("Grep").permission, "deny");
  });
  it("does not truncate large real Cursor beforeReadFile payloads after MCP succeeds", () => {
    const ids = { conversation_id: "cursor-chat-1", generation_id: "gen-a" };
    event("beforeSubmitPrompt", { ...ids, prompt: "blackout" });
    assert.equal(event("beforeReadFile", { ...ids, file_path: "core.lua" }).permission, "deny");
    lookup(undefined, ids);
    // Actual logged beforeReadFile input is >350,000 characters. Old hook
    // stopped collecting at 100,000, producing SyntaxError then deny.
    const attachments = [{ type: "context", data: "x".repeat(380000) }];
    assert.equal(event("beforeReadFile", { ...ids, file_path: "core.lua", attachments }).permission, "allow");
    assert.equal(event("preToolUse", { ...ids, tool_name: "Write", tool_input: { file_path: "core.lua" }, attachments }).permission, "allow");
    assert.equal(event("beforeShellExecution", { ...ids, command: "luac -p core.lua", attachments }).permission, "allow");
  });
  it("isolates concurrent Cursor conversations and generations", () => {
    const first = { conversation_id: "chat-a", generation_id: "run-1" };
    const second = { conversation_id: "chat-b", generation_id: "run-2" };
    const next = { conversation_id: "chat-a", generation_id: "run-3" };
    event("beforeSubmitPrompt", first);
    lookup(undefined, first);
    assert.equal(event("preToolUse", { ...first, tool_name: "Write" }).permission, "allow");
    event("beforeSubmitPrompt", second);
    assert.equal(event("beforeReadFile", { ...second, file_path: "core.lua" }).permission, "deny");
    assert.equal(event("preToolUse", { ...first, tool_name: "Write" }).permission, "allow");
    lookup(undefined, second);
    assert.equal(event("preToolUse", { ...second, tool_name: "Write" }).permission, "allow");
    event("beforeSubmitPrompt", next);
    assert.equal(event("preToolUse", { ...next, tool_name: "Write" }).permission, "deny");
    assert.equal(event("preToolUse", { ...first, tool_name: "Write" }).permission, "allow");
    event("beforeSubmitPrompt", first);
    assert.equal(event("preToolUse", { ...first, tool_name: "Write" }).permission, "deny");
  });
  it("works with Cursor hook events that have no conversation ID", () => {
    event("beforeSubmitPrompt", { prompt: "photo item" });
    assert.equal(event("preToolUse", { tool_name: "Grep", tool_input: { pattern: "outubrorosa" } }).permission, "deny");
    lookup();
    assert.equal(denied("Grep").permission, "allow");
  });
  it("finds project root when invoked inside a resource subdirectory", () => {
    const nested = path.join(dir, "resources", "[ecco]", "inventory", "web-side");
    fs.mkdirSync(nested, { recursive: true });
    event("beforeSubmitPrompt", {}, { cwd: nested });
    assert.equal(event("beforeReadFile", { file_path: path.join(nested, "index.html") }, { cwd: nested }).permission, "deny");
    assert.equal(event("preToolUse", { tool_name: "Grep" }, { cwd: nested }).permission, "deny");
    assert.equal(event("preToolUse", { tool_name: "Grep" }, { cwd: nested }).permission, "deny");
    event("afterMCPExecution", {
      mcp_server_name: "fxmind", tool_name: "fxmind_query",
      result_json: JSON.stringify({ content: [{ type: "text", text: "memory item and flyer" }] }),
    }, { cwd: nested });
    assert.equal(event("preToolUse", { tool_name: "Grep" }, { cwd: nested }).permission, "allow");
  });
  it("fails closed when FxMind workspace cannot be resolved", () => {
    fs.rmSync(path.join(dir, ".fxmind"), { recursive: true });
    assert.equal(denied("Grep").permission, "deny");
    assert.equal(event("beforeReadFile", { file_path: "core.lua" }).permission, "deny");
    // Prompt delivery must stay available so the agent can request FXMIND.
    assert.equal(event("beforeSubmitPrompt").continue, true);
  });
  it("never blocks prompt submission when the state directory is unavailable", () => {
    // Simulate Windows access-denied / file-lock on state persistence.
    const scriptText = [
      "const fs=require('node:fs');",
      "const hook=require(" + JSON.stringify(script) + ");",
      "const orig=fs.mkdirSync;",
      "fs.mkdirSync=function(p,...a){if(String(p).includes('cursor-memory-first')){const e=new Error('locked');e.code='EACCES';throw e;}return orig.call(this,p,...a);};",
      "const prompt=hook.run('beforeSubmitPrompt',{prompt:'start'},{FXMIND_TARGET:''});",
      "const tool=hook.run('preToolUse',{tool_name:'Grep'},{FXMIND_TARGET:''});",
      "console.log(JSON.stringify({prompt,tool}));",
    ].join("\n");
    const p = spawnSync(global.process.execPath, ["-e", scriptText], { cwd: dir, encoding: "utf8", timeout: 4000 });
    assert.equal(p.status, 0, p.stderr);
    const response = JSON.parse(p.stdout);
    assert.equal(response.prompt.continue, true);
    assert.equal(response.tool.permission, "deny");
  });
  it("allows only FxMind memory MCP on malformed Cursor preToolUse JSON", () => {
    const malformed = [
      '{"tool_name":"MCP:fxmind_query","tool_input":{"question":"x"}',
      '{"tool_name":"MCP:fxmind_read_file","tool_input":{"path":".fxmind/memory/item.md"}',
      '{"tool_name":"MCP:fxmind_search","tool_input":{"query":"flyer"}',
    ];
    for (const input of malformed) {
      const run = spawnSync(global.process.execPath, [script, "preToolUse"], {
        cwd: dir, input, encoding: "utf8", timeout: 4000,
      });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout).permission, "allow", input);
    }
    for (const name of ["Grep", "Read", "MCP:fxmind_start_task", "MCP:other_tool"]) {
      const run = spawnSync(global.process.execPath, [script, "preToolUse"], {
        cwd: dir, input: '{"tool_name":"' + name + '","tool_input":{"x":1}',
        encoding: "utf8", timeout: 4000,
      });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout).permission, "deny", name);
    }
    // False tool_name text inside user-provided tool_input MUST NOT unlock.
    const spoofed = '{"tool_name":"Grep","tool_input":{"pattern":"\\\"tool_name\\\":\\\"MCP:fxmind_query\\\""}';
    const r = spawnSync(global.process.execPath, [script, "preToolUse"], {
      cwd: dir, input: spoofed, encoding: "utf8", timeout: 4000,
    });
    assert.equal(JSON.parse(r.stdout).permission, "deny");
  });
  it("handles invalid Cursor stdin without stopping prompt delivery or allowing tools", () => {
    for (const [kind,expected] of [["beforeSubmitPrompt","continue"], ["preToolUse","permission"]]) {
      const p = spawnSync(global.process.execPath, [script, kind], {
        cwd: dir, input: "{malformed", encoding: "utf8", timeout: 4000,
      });
      assert.equal(p.status, 0, p.stderr);
      const result = JSON.parse(p.stdout);
      if (expected === "continue") assert.equal(result.continue, true);
      else assert.equal(result.permission, "deny");
    }
  });
  it("stores only booleans/version/timestamps, never user input or secrets", () => {
    event("beforeSubmitPrompt", { prompt: "TOPSECRET-user-prompt" });
    const result = event("preToolUse", { tool_name: "Grep", tool_input: { pattern: "TOPSECRET-pattern" } });
    assert.equal(result.permission, "deny");
    const stateDir = path.join(dir, ".fxmind", "state", "cursor-memory-first");
    const contents = fs.readFileSync(path.join(stateDir, fs.readdirSync(stateDir)[0]), "utf8");
    assert.doesNotMatch(contents, /TOPSECRET/);
  });
  it("installer registers unconditional preToolUse and beforeMCP/Read/Shell guards with failClosed", () => {
    fs.writeFileSync(path.join(dir, ".cursorignore"), ".fxmind/*\nnode_modules\n");
    installHooks(dir, { gitHook: false });
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".cursor", "hooks.json"), "utf8")).hooks;
    const main = cfg.preToolUse.find((e) => e.command.includes("memory-first.js"));
    assert.equal(main.matcher, undefined);
    assert.equal(main.failClosed, true);
    for (const type of ["beforeShellExecution", "beforeReadFile", "beforeMCPExecution"]) {
      assert.equal(cfg[type][0].failClosed, true, type);
    }
    assert.match(fs.readFileSync(path.join(dir, ".cursorignore"), "utf8"), /^.fxmind\/state\/$/m);
  });
  it("installs portable commands that work from Cursor host cwd without leaking root", () => {
    const project = path.join(dir, "FX MIND [ECCO]");
    fs.mkdirSync(path.join(project, ".fxmind", "memory"), { recursive: true });
    installHooks(project, { gitHook: false });
    const hooksPath = path.join(project, ".cursor", "hooks.json");
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")).hooks;
    const invoke = (kind, input) => {
      const cmd = hooks[kind].find((e) => e.command.includes("memory-first.js"));
      assert.ok(cmd && cmd.command.startsWith('node -e "'), kind);
      assert.ok(!cmd.command.includes(project.replace(/\\/g, "/")), kind);
      assert.ok(!cmd.command.includes("cwd-bootstrap.js"), kind);
      const res = spawnSync(cmd.command, {
        shell: true, cwd: os.tmpdir(), encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: project },
        input: JSON.stringify({ hook_event_name: kind, workspace_roots: [project], ...input }), timeout: 6000,
      });
      assert.equal(res.status, 0, String(res.stderr) + "\n" + String(res.stdout));
      return JSON.parse(res.stdout);
    };
    assert.equal(invoke("beforeSubmitPrompt", { prompt: "find flyer" }).continue, true);
    assert.equal(invoke("preToolUse", { tool_name: "Grep" }).permission, "deny");
    assert.equal(invoke("beforeReadFile", { file_path: "main.lua" }).permission, "deny");
    assert.equal(invoke("beforeMCPExecution", { tool_name: "fxmind_query", mcp_server_name: "fxmind" }).permission, "allow");
    invoke("afterMCPExecution", {
      mcp_server_name: "fxmind", tool_name: "fxmind_query",
      result_json: JSON.stringify({ content: [{ type: "text", text: "memory: inventory" }] }),
    });
    assert.equal(invoke("preToolUse", { tool_name: "Grep" }).permission, "allow");
    // All other registered hooks must be invocable from outside the workspace too.
    for (const event of Object.keys(hooks)) for (const spec of hooks[event]) {
      if (!spec.command.includes(".cursor/hooks/")) continue;
      assert.ok(spec.command.startsWith('node -e "'), event);
      assert.ok(!spec.command.includes(project.replace(/\\/g, "/")), event);
    }
  });
  it("native PowerShell forwards Cursor JSON to the portable hook", { skip: process.platform !== "win32" }, () => {
    const project = path.join(dir, "PS root [portable]");
    fs.mkdirSync(path.join(project, ".fxmind", "memory"), { recursive: true });
    installHooks(project, { gitHook: false });
    const hooks = JSON.parse(fs.readFileSync(path.join(project, ".cursor", "hooks.json"), "utf8")).hooks;
    const command = hooks.preToolUse.find((spec) => spec.command.includes("memory-first.js")).command;
    const prefix = 'node -e "';
    assert.ok(command.startsWith(prefix));
    const js = command.slice(prefix.length, -1);
    const quotePS = (v) => "'" + v.replace(/'/g, "''") + "'";
    const input = JSON.stringify({
      hook_event_name: "preToolUse",
      tool_name: "MCP:fxmind_query",
      conversation_id: "portable-powershell",
      generation_id: "current",
    });
    const ps = "$env:CURSOR_PROJECT_DIR=" + quotePS(project) +
      ";$js=" + quotePS(js) + ";$payload=" + quotePS(input) +
      ";$payload | node -e $js";
    const response = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      cwd: os.tmpdir(), encoding: "utf8", timeout: 7000,
    });
    assert.equal(response.status, 0, response.stderr);
    assert.equal(JSON.parse(response.stdout.trim()).permission, "allow");
  });
  it("reinstallation replaces obsolete relative hook commands without duplicating entries", () => {
    const first = installHooks(dir, { gitHook: false });
    const hooksPath = path.join(dir, ".cursor", "hooks.json");
    const before = fs.readFileSync(hooksPath, "utf8");
    const config = JSON.parse(before);
    config.hooks.preToolUse[0].command = "node .cursor/hooks/gate-guard.js";
    // Previous releases persisted the installer developer's absolute path.
    config.hooks.preToolUse[1].command = 'node --require "F:/[FIVEM]/[ECCO]/ecco/.cursor/hooks/cwd-bootstrap.js" "F:/[FIVEM]/[ECCO]/ecco/.cursor/hooks/memory-first.js" preToolUse';
    fs.writeFileSync(hooksPath, JSON.stringify(config));
    installHooks(dir, { gitHook: false });
    const refreshed = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    assert.equal(refreshed.hooks.preToolUse.length, 2);
    assert.ok(refreshed.hooks.preToolUse.every((entry) => entry.command.startsWith('node -e "')));
    const next = fs.readFileSync(hooksPath, "utf8");
    installHooks(dir, { gitHook: false });
    assert.equal(fs.readFileSync(hooksPath, "utf8"), next);
  });
  it("installer bundles all gate-guard transitive dependencies and runs it", () => {
    installHooks(dir, { gitHook: false });
    for (const module of ["lua-scope-check.js","independent-review.js","ui-impact.js"]) {
      assert.ok(fs.existsSync(path.join(dir, ".cursor", "hooks", "lib", module)), module);
    }
    const config = JSON.parse(fs.readFileSync(path.join(dir, ".cursor", "hooks.json"), "utf8"));
    const gate = config.hooks.preToolUse.find(item => item.command.includes("gate-guard.js"));
    assert.ok(gate?.command);
    const result = spawnSync(gate.command, {
      shell: true, cwd: os.tmpdir(), encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
      input: JSON.stringify({ hook_event_name: "preToolUse", workspace_roots: [dir], tool_name: "MCP:fxmind_query", tool_input: { question: "test" } }),
      timeout: 6000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|Cannot find module/);
  });
  it("uninstall removes portable installed hooks without erasing unrelated hooks", () => {
    installHooks(dir, { gitHook: false });
    const hooksPath = path.join(dir, ".cursor", "hooks.json");
    const cfg = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    cfg.hooks.preToolUse.push({ command: "node custom-hook.js", timeout: 5 });
    fs.writeFileSync(hooksPath, JSON.stringify(cfg));
    uninstallHooks(dir);
    const removed = JSON.parse(fs.readFileSync(hooksPath, "utf8")).hooks;
    assert.deepEqual(removed.preToolUse, [{ command: "node custom-hook.js", timeout: 5 }]);
    assert.ok(!fs.existsSync(path.join(dir, ".cursor", "hooks", "cwd-bootstrap.js")));
  });
});