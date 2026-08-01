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
