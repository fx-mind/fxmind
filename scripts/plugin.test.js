"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const launcher = require("./plugin-mcp");
const ROOT = path.resolve(__dirname, "..");
const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

test("portable and Claude manifests reference the same plugin/runtime", () => {
  const pkg = json("package.json");
  const plugin = json("plugin.json");
  const portable = json("mcp.json");
  const claude = json(".claude-plugin/plugin.json");
  const claudeMcp = json(".mcp.json");
  const cursor = json(".cursor-plugin/plugin.json");
  assert.equal(plugin.name, "fxmind");
  assert.equal(plugin.version, pkg.version);
  assert.equal(claude.version, pkg.version);
  assert.equal(cursor.version, pkg.version);
  assert.deepEqual(cursor.mcpServers.fxmind.args, ["${CURSOR_PLUGIN_ROOT}/scripts/plugin-mcp.js"]);
  assert.match(plugin.$schema, /agent-plugins\.org/);
  assert.match(portable.$schema, /mcp\.schema\.json/);
  assert.equal(portable.mcpServers.fxmind.type, "stdio");
  assert.equal(portable.mcpServers.fxmind.command, "node");
  assert.deepEqual(portable.mcpServers.fxmind.args, ["${PLUGIN_ROOT}/scripts/plugin-mcp.js"]);
  assert.deepEqual(claudeMcp.mcpServers.fxmind.args, ["${CLAUDE_PLUGIN_ROOT}/scripts/plugin-mcp.js"]);
  assert.equal(plugin.extensions["com.openai"].onboardingSkill, "./skills/fxmind-setup/SKILL.md");
  for (const item of ["plugin.json", "mcp.json", ".mcp.json", ".claude-plugin", ".cursor-plugin", "skills"]) {
    assert.ok(pkg.files.includes(item), item + " must be packed");
  }
});

test("packed skill stays identical to FXMIND source template", () => {
  const source = fs.readFileSync(path.join(ROOT, "templates", "skills", "fxmind", "SKILL.md"), "utf8");
  const packed = fs.readFileSync(path.join(ROOT, "skills", "fxmind", "SKILL.md"), "utf8");
  assert.equal(packed, source);
  assert.match(fs.readFileSync(path.join(ROOT, "skills", "fxmind-setup", "SKILL.md"), "utf8"), /FXMIND_TARGET/);
});

test("launcher refuses unknown, uninitialized, or self-owned target", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-plugin-target-"));
  try {
    assert.throws(() => launcher.projectRoot({}), /FXMIND_TARGET/);
    assert.throws(() => launcher.projectRoot({ FXMIND_TARGET: ROOT }), /not the plugin/);
    assert.throws(() => launcher.projectRoot({ FXMIND_TARGET: temp }), /packs\.json/);
    fs.mkdirSync(path.join(temp, ".fxmind"));
    fs.writeFileSync(path.join(temp, ".fxmind", "packs.json"), '{"packs":[]}');
    assert.equal(launcher.projectRoot({ FXMIND_TARGET: temp }), path.resolve(temp));
    assert.equal(launcher.projectRoot({ CLAUDE_PROJECT_DIR: temp }), path.resolve(temp));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("launcher exits cleanly without a project, never emitting MCP JSON", () => {
  const cp = spawnSync(process.execPath, [path.join(__dirname, "plugin-mcp.js")], {
    cwd: ROOT, env: { ...process.env, FXMIND_TARGET: "", CLAUDE_PROJECT_DIR: "" },
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(cp.status, 1);
  assert.match(cp.stderr, /FXMIND_TARGET/);
  assert.equal(cp.stdout, "");
});

test("stdio adapter lists MCP tools for the selected project", async (t) => {
  if (!launcher.selectRuntime()) return t.skip("MCP runtime dependencies are not installed");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-plugin-mcp-"));
  fs.mkdirSync(path.join(temp, ".fxmind"));
  fs.writeFileSync(path.join(temp, ".fxmind", "packs.json"), '{"packs":[]}');
  const cp = spawn(process.execPath, [path.join(__dirname, "plugin-mcp.js")], {
    cwd: ROOT,
    env: { ...process.env, FXMIND_TARGET: temp, CLAUDE_PROJECT_DIR: "", FXMIND_MCP_TOOLS: "all", FXMIND_MCP_READONLY: "1" },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const reader = readline.createInterface({ input: cp.stdout });
  try {
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP tools/list timeout")), 12000);
      cp.on("error", reject);
      reader.on("line", (line) => {
        try {
          const item = JSON.parse(line);
          if (item.id !== 7) return;
          clearTimeout(timer);
          resolve(item);
        } catch (error) { clearTimeout(timer); reject(error); }
      });
      cp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }) + "\n");
    });
    const names = response.result.tools.map((tool) => tool.name);
    assert.ok(names.includes("fxmind_query"));
    assert.ok(names.includes("fxmind_search"));
    assert.ok(!names.includes("fxmind_record_gate"));
    const directNames = require("./mcp-server").listTools(temp, {
      ...process.env, FXMIND_MCP_TOOLS: "all", FXMIND_MCP_READONLY: "1",
    }).map((tool) => tool.name);
    assert.deepEqual(names.sort(), directNames.sort(), "plugin and direct MCP must expose identical tools");
  } finally {
    reader.close();
    cp.stdin.end();
    if (cp.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => cp.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    if (cp.exitCode === null) cp.kill();
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
