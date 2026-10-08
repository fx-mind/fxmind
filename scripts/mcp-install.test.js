const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mcp = require("./mcp-install");

describe("mcp install agent filtering", () => {
  it("does not install Claude .mcp.json when only Cursor is installed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-"));
    fs.mkdirSync(path.join(dir, ".fxmind"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".fxmind", "packs.json"),
      JSON.stringify({ agents: ["cursor", "claude"] }),
      "utf8",
    );
    fs.mkdirSync(path.join(dir, ".cursor", "skills", "fxmind"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cursor", "skills", "fxmind", "SKILL.md"), "# fxmind\n", "utf8");

    const result = mcp.installMcp(dir, { agentIds: ["cursor", "claude"] });
    assert.deepEqual(result.agentIds, ["cursor"]);
    assert.ok(fs.existsSync(path.join(dir, ".cursor", "mcp.json")));
    assert.equal(fs.existsSync(path.join(dir, ".mcp.json")), false);
  });

  it("prunes stale .mcp.json when Claude is no longer installed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-"));
    fs.mkdirSync(path.join(dir, ".fxmind"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".fxmind", "packs.json"),
      JSON.stringify({ agents: ["cursor"] }),
      "utf8",
    );
    fs.mkdirSync(path.join(dir, ".cursor", "skills", "fxmind"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cursor", "skills", "fxmind", "SKILL.md"), "# fxmind\n", "utf8");
    fs.writeFileSync(
      path.join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { fxmind: { command: "fxmind-mcp" } } }),
      "utf8",
    );

    const result = mcp.installMcp(dir, { agentIds: ["cursor"] });
    assert.deepEqual(result.agentIds, ["cursor"]);
    assert.ok(result.pruned.includes(".mcp.json"));
    assert.equal(fs.existsSync(path.join(dir, ".mcp.json")), false);
  });

  it("installs VS Code Copilot MCP under servers key in .vscode/mcp.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-"));
    fs.mkdirSync(path.join(dir, ".github", "skills", "fxmind"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".github", "skills", "fxmind", "SKILL.md"), "# fxmind\n", "utf8");

    const result = mcp.installMcp(dir, { agentIds: ["copilot"] });
    assert.deepEqual(result.agentIds, ["copilot"]);
    const config = JSON.parse(fs.readFileSync(path.join(dir, ".vscode", "mcp.json"), "utf8"));
    assert.ok(config.servers?.fxmind);
    assert.equal(config.servers.fxmind.type, "stdio");
    assert.ok(config.servers.fxmind.command);
    assert.equal(config.mcpServers, undefined);
  });
});

describe("mcp server path", () => {
  it("writes the explicit server path instead of the default APPDATA one", { skip: process.platform !== "win32" }, () => {
    const previous = process.env.FXMIND_MCP_SERVER_PATH;
    process.env.FXMIND_MCP_SERVER_PATH = "C:\\custom\\fxmind\\scripts\\mcp-server.js";
    try {
      assert.deepEqual(mcp.buildFxmindMcpEntry().args, ["C:/custom/fxmind/scripts/mcp-server.js"]);
      assert.deepEqual(mcp.resolveOpenCodeMcpLaunch().command, ["node", "C:/custom/fxmind/scripts/mcp-server.js"]);
    } finally {
      if (previous === undefined) delete process.env.FXMIND_MCP_SERVER_PATH;
      else process.env.FXMIND_MCP_SERVER_PATH = previous;
    }
  });

  it("marks OpenCode MCP with its provider identity", () => {
    const launch = mcp.resolveOpenCodeMcpLaunch();
    assert.equal(launch.environment.FXMIND_AGENT_ID, "opencode");
  });

  it("keeps the portable APPDATA form from a dev checkout", { skip: process.platform !== "win32" }, () => {
    assert.deepEqual(mcp.buildFxmindMcpEntry().args, ["${env:APPDATA}/npm/node_modules/fxmind/scripts/mcp-server.js"]);
  });
});

describe("claude mcp entry", () => {
  it("uses Claude Code's ${VAR} expansion and no FXMIND_TARGET", { skip: process.platform !== "win32" }, () => {
    const entry = mcp.buildFxmindMcpEntry("claude");
    assert.deepEqual(entry.args, ["${APPDATA}/npm/node_modules/fxmind/scripts/mcp-server.js"]);
    assert.equal(entry.env.FXMIND_TARGET, undefined);
    assert.equal(mcp.buildFxmindMcpEntry("cursor").env.FXMIND_TARGET, "${workspaceFolder}");
    assert.equal(mcp.buildFxmindMcpEntry("cursor").env.FXMIND_AGENT_ID, "cursor");
    assert.equal(entry.env.FXMIND_AGENT_ID, "claude");
    assert.match(mcp.buildFxmindMcpEntry("cursor").args[0], /\$\{env:APPDATA\}/);
  });

  it("writes it to .mcp.json and heals an entry written in Cursor syntax", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-claude-"));
    try {
      fs.writeFileSync(
        path.join(dir, ".mcp.json"),
        JSON.stringify({ mcpServers: { fxmind: { command: "node", args: ["${env:APPDATA}/x.js"], env: { FXMIND_TARGET: "${workspaceFolder}" } }, other: { command: "x" } } }),
      );
      mcp.installMcpForAgent(dir, "claude");
      const config = JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"));
      assert.ok(config.mcpServers.other);
      assert.doesNotMatch(JSON.stringify(config.mcpServers.fxmind), /env:|workspaceFolder/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
