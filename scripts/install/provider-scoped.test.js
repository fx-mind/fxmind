"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const entrypoint = path.join(__dirname, "..", "install.js");
let root;
const tracked = [
  ".fxmind/packs.json", ".fxmind/packs.lock.json",
  ".fxmind/memory/fivem.md", ".cursor/mcp.json", ".mcp.json",
];

function file(relative) { return path.join(root, relative); }
function put(relative, content) {
  fs.mkdirSync(path.dirname(file(relative)), { recursive: true });
  fs.writeFileSync(file(relative), content);
}
function read(relative) { return fs.readFileSync(file(relative), "utf8"); }
function run(flags) {
  const p = spawnSync(process.execPath, [entrypoint, "--target", root, ...flags, "-y"], {
    cwd: root, encoding: "utf8", timeout: 12000, maxBuffer: 1000000,
  });
  assert.equal(p.status, 0, p.stderr + p.stdout);
  return p.stdout;
}

describe("provider-only installation is scoped to requested providers", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-provider-only-"));
    put(".fxmind/packs.json", JSON.stringify({
      version: 1, packs: [{ id: "fivem", label: "FiveM" }],
      updatedAt: "2026-10-10", agents: ["cursor", "claude"],
    }, null, 2));
    put(".fxmind/packs.lock.json", JSON.stringify({
      version: 1, packs: [{ id: "fivem", sha: "unchanged" }],
    }, null, 2));
    put(".fxmind/memory/fivem.md", "# Knowledge must not change\n");
    put(".cursor/mcp.json", JSON.stringify({
      mcpServers: { custom: { command: "my-mcp" }, fxmind: { command: "node", args: ["existing"] } },
    }, null, 2));
    put(".mcp.json", '{"mcpServers":{"custom":{"command":"other"}}}\n');
    put("opencode.json", JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      custom: "untouched", mcp: { other: { type: "local", command: ["node", "other"] } },
    }, null, 2));
    put("sentinel.txt", "Unrelated file preserved\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("runs portable OpenCode and Codex MCP from each user's own APPDATA", { skip: process.platform !== "win32" }, () => {
    const appdata = file("different-user/AppData/Roaming");
    const server = path.join(appdata, "npm", "node_modules", "fxmind", "scripts", "mcp-server.js");
    fs.mkdirSync(path.dirname(server), { recursive: true });
    fs.writeFileSync(server,
      "process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({ok:true,agent:process.env.FXMIND_AGENT_ID})+'\\n');});");
    const mcp = require("../mcp-install");
    for (const agent of ["opencode", "codex"]) {
      const args = agent === "opencode"
        ? mcp.resolveOpenCodeMcpLaunch().command.slice(1)
        : mcp.buildFxmindMcpEntry("codex").args;
      assert.equal(args[0], "-e");
      assert.ok(!JSON.stringify(args).includes(appdata));
      const result = spawnSync("node", args, {
        cwd: root, encoding: "utf8", timeout: 7000,
        env: { ...process.env, APPDATA: appdata, FXMIND_MCP_SERVER_PATH: "", FXMIND_AGENT_ID: agent },
        input: "{}\\n",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout.trim()).agent, agent);
    }
  });

  it("installs only OpenCode, preserving all packs, memories and other providers", () => {
    const original = Object.fromEntries(tracked.map(p => [p, read(p)]));
    const stdout = run(["--opencode"]);
    assert.match(stdout, /Providers: opencode/);
    for (const p of tracked) assert.equal(read(p), original[p], p);
    assert.equal(read("sentinel.txt"), "Unrelated file preserved\n");
    const opencode = JSON.parse(read("opencode.json"));
    assert.equal(opencode.custom, "untouched");
    assert.deepEqual(opencode.mcp.other.command, ["node", "other"]);
    assert.ok(opencode.mcp.fxmind);
    assert.equal(opencode.mcp.fxmind.command[1], "-e");
    assert.doesNotMatch(JSON.stringify(opencode.mcp.fxmind), /[a-zA-Z]:[\\/]/);
    assert.ok(!fs.existsSync(file(".fxmind/graph/knowledge-graph.json")));
    assert.ok(!fs.existsSync(file("web/dist/index.html")));
    const before = read("opencode.json");
    run(["--opencode"]);
    assert.equal(read("opencode.json"), before, "repeated provider install must be idempotent");
    for (const p of tracked) assert.equal(read(p), original[p], p);
  });

  it("installs only Cursor and preserves pre-existing OpenCode and pack files", () => {
    const packBefore = read(".fxmind/packs.json");
    const lockBefore = read(".fxmind/packs.lock.json");
    const opencodeBefore = read("opencode.json");
    run(["--cursor"]);
    assert.equal(read(".fxmind/packs.json"), packBefore);
    assert.equal(read(".fxmind/packs.lock.json"), lockBefore);
    assert.equal(read("opencode.json"), opencodeBefore);
    const cursor = JSON.parse(read(".cursor/mcp.json"));
    assert.equal(cursor.mcpServers.custom.command, "my-mcp");
    assert.ok(cursor.mcpServers.fxmind);
    const second = read(".cursor/mcp.json");
    run(["--cursor"]);
    assert.equal(read(".cursor/mcp.json"), second);
  });

  it("rebuilds legacy lockfiles without leaking personal cache paths or churning timestamps", () => {
    const locks = require("../lockfile");
    const skills = file("some-private-absolute-cache/skills");
    const topic = path.join(skills, "fivem-development");
    fs.mkdirSync(topic, { recursive: true });
    fs.writeFileSync(path.join(topic, "SKILL.md"), "# Example skill");
    const prior = JSON.parse(read(".fxmind/packs.lock.json"));
    prior.packs[0].resolvedSkillsDir = "C:/Users/other-person/private/.fxmind/packs-cache/fivem-skill";
    put(".fxmind/packs.lock.json", JSON.stringify(prior, null, 2));
    const options = { packSkillsDirs: { fivem: skills } };
    assert.equal(locks.writeLockfile(root, ["fivem"], options).changed, true);
    const first = read(".fxmind/packs.lock.json");
    assert.ok(!first.includes("resolvedSkillsDir"));
    assert.ok(!first.includes("other-person"));
    assert.equal(locks.writeLockfile(root, ["fivem"], options).changed, false);
    assert.equal(read(".fxmind/packs.lock.json"), first);
  });

  it("does not touch unrelated providers during multi-provider installation", () => {
    const original = Object.fromEntries(tracked.slice(0, 3).map(p => [p, read(p)]));
    run(["--agent", "cursor,claude"]);
    for (const [p, v] of Object.entries(original)) assert.equal(read(p), v, p);
    assert.equal(JSON.parse(read("opencode.json")).custom, "untouched");
    assert.equal(JSON.parse(read(".cursor/mcp.json")).mcpServers.custom.command, "my-mcp");
    assert.equal(JSON.parse(read(".mcp.json")).mcpServers.custom.command, "other");
  });
});
