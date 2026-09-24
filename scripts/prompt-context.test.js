const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const promptContext = require("./prompt-context");
const mcp = require("./mcp-server");

function writeProject(root) {
  const mem = path.join(root, ".fxmind", "memory");
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(
    path.join(mem, "garage.md"),
    "---\ntopic: garage\nupdated: 2026-09-01\nlang: en-compact\npaths: [resources/garage/client.lua]\ntriggers: [garage, spawn vehicle]\n---\n# garage\nGarage opens NUI; server checks ownership.\n",
    "utf8",
  );
}

describe("prompt-context", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxprompt-"));
    writeProject(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips short prompts and other slash commands", () => {
    assert.equal(promptContext.shouldSkipPrompt("oi"), true);
    assert.equal(promptContext.shouldSkipPrompt("/compact agora por favor"), true);
    assert.equal(promptContext.shouldSkipPrompt("/fxmind task garagem nao abre"), false);
    assert.equal(promptContext.shouldSkipPrompt("a garagem nao abre"), false);
  });

  it("finds the project root from a nested directory", () => {
    const nested = path.join(root, "resources", "garage");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(promptContext.findProjectRoot(nested), root);
  });

  it("hook emits additionalContext for a matching prompt", () => {
    const run = spawnSync(process.execPath, [path.join(__dirname, "install.js"), "context", "--hook"], {
      input: JSON.stringify({ prompt: "a garagem nao abre", cwd: root, hook_event_name: "UserPromptSubmit" }),
      encoding: "utf8",
      env: { ...process.env, FXMIND_NO_UPDATE_CHECK: "1" },
    });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(out.hookSpecificOutput.additionalContext, /garage/);
    assert.match(out.hookSpecificOutput.additionalContext, /Garage opens NUI/);
  });

  it("hook prints nothing when no memory matches", () => {
    const run = spawnSync(process.execPath, [path.join(__dirname, "install.js"), "context", "--hook"], {
      input: JSON.stringify({ prompt: "explique o que e um monad", cwd: root }),
      encoding: "utf8",
      env: { ...process.env, FXMIND_NO_UPDATE_CHECK: "1" },
    });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
  });

  it("installs the Claude Code hook once and keeps other settings", () => {
    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
    assert.equal(promptContext.installClaudePromptHook(root).changed, true);
    assert.equal(promptContext.installClaudePromptHook(root).changed, false);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
    const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks.map((h) => h.command));
    assert.deepEqual(commands, [promptContext.CLAUDE_HOOK_COMMAND]);
  });
});

describe("mcp tool groups", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-"));
    fs.mkdirSync(path.join(root, ".fxmind"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const names = (list) => list.map((tool) => tool.name);

  it("hides FiveM tools without the fivem pack and DB tools without a connection", () => {
    fs.writeFileSync(path.join(root, ".fxmind", "packs.json"), JSON.stringify({ packs: [] }));
    const listed = names(mcp.listTools(root, {}));
    assert.ok(listed.includes("fxmind_query"));
    assert.ok(listed.includes("fxmind_db_status"));
    assert.ok(listed.includes("fxmind_panel_wait"));
    assert.ok(!listed.some((n) => n.startsWith("fxmind_fivem_")));
    assert.ok(!listed.includes("fxmind_db_query"));
  });

  it("keeps FiveM tools when the pack is installed or the manifest is missing", () => {
    assert.ok(names(mcp.listTools(root, {})).includes("fxmind_fivem_status"));
    fs.writeFileSync(path.join(root, ".fxmind", "packs.json"), JSON.stringify({ packs: [{ id: "fivem" }] }));
    assert.ok(names(mcp.listTools(root, {})).includes("fxmind_fivem_status"));
  });

  it("FXMIND_MCP_TOOLS overrides detection", () => {
    assert.equal(mcp.listTools(root, { FXMIND_MCP_TOOLS: "all" }).length, mcp.TOOL_DEFS.length);
    const core = names(mcp.listTools(root, { FXMIND_MCP_TOOLS: "core" }));
    assert.ok(!core.includes("fxmind_panel_wait"));
    assert.ok(core.includes("fxmind_record_gate"));
  });

  it("formats query results as Markdown and other results as compact JSON", () => {
    const text = mcp.formatToolResult("fxmind_gate_status", { ok: true, a: 1 });
    assert.equal(text, '{"ok":true,"a":1}');
    const query = mcp.formatToolResult("fxmind_query", {
      ok: true,
      memories: [{ slug: "x", topic: "x", path: ".fxmind/memory/x.md", content: "Body", tokens: 1 }],
      tokensUsed: 1,
      budget: 10,
    });
    assert.match(query, /## x — \.fxmind\/memory\/x\.md\nBody/);
  });
});
