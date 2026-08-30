const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panelInstall = require("./panel-install");
const { installMcpForAgent, mcpStatusForAgent } = require("../mcp-install");

describe("panel-install", () => {
  it("getSetupStatus reports missing .fxmind", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxsetup-"));
    try {
      const status = panelInstall.getSetupStatus(cwd);
      assert.equal(status.hasFxmind, false);
      assert.equal(status.graphBuilt, false);
      assert.equal(status.mcp.server, "fxmind");
      assert.ok(status.mcp.tools.length > 0);
      assert.ok(status.mcp.agents.some((agent) => agent.agentId === "codex"));
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("listAvailablePacks returns packs and agents", () => {
    const catalog = panelInstall.listAvailablePacks();
    assert.equal(catalog.ok, true);
    assert.ok(Array.isArray(catalog.packs));
    assert.ok(catalog.packs.length > 0);
    assert.ok(Array.isArray(catalog.agents));
    assert.ok(catalog.agents.some((a) => a.id === "cursor"));
  });

  it("getSetupStatus detects installed project", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxsetup-"));
    try {
      fs.mkdirSync(path.join(cwd, ".fxmind", "memory"), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, ".fxmind", "packs.json"),
        JSON.stringify({ packs: [{ id: "fivem", label: "FiveM" }], agents: ["cursor"] }),
        "utf8",
      );
      const status = panelInstall.getSetupStatus(cwd);
      assert.equal(status.hasFxmind, true);
      assert.deepEqual(status.packs, ["fivem"]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports the fxmind MCP installation without exposing secrets", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-"));
    try {
      installMcpForAgent(cwd, "cursor");
      const status = panelInstall.getSetupStatus(cwd);
      const cursor = status.mcp.agents.find((agent) => agent.agentId === "cursor");
      assert.equal(status.mcp.installed, true);
      assert.equal(cursor.installed, true);
      assert.equal(cursor.configRel, ".cursor/mcp.json");
      assert.equal("entry" in cursor, false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("writes a runnable Codex MCP launcher", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxcodex-mcp-"));
    try {
      installMcpForAgent(cwd, "codex");
      const configPath = path.join(cwd, ".codex", "config.toml");
      const config = fs.readFileSync(configPath, "utf8");
      const status = mcpStatusForAgent(cwd, "codex");
      assert.equal(status.installed, true);
      assert.equal(status.entry.command, process.platform === "win32" ? "node" : "fxmind-mcp");
      assert.match(config, /\[mcp_servers\.fxmind\]/);
      assert.match(config, /\[mcp_servers\.fxmind\.env\]/);
      assert.match(config, /FXMIND_TARGET\s*=/);
      if (process.platform === "win32") {
        assert.match(config, /args\s*=\s*\[.*mcp-server\.js/);
        assert.equal(status.entry.args.length, 1);
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("lists, edits, and toggles a local skill safely", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxskills-"));
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "fxskill-src-"));
    try {
      fs.mkdirSync(path.join(cwd, ".fxmind"), { recursive: true });
      fs.writeFileSync(path.join(source, "SKILL.md"), "# Local skill\n", "utf8");
      const installed = panelInstall.installSkillFromLocal(cwd, source, "local-skill");
      assert.equal(installed.ok, true);
      assert.equal(panelInstall.listSkills(cwd)[0].active, true);
      assert.equal(panelInstall.readSkill(cwd, "local-skill").content, "# Local skill\n");
      assert.equal(panelInstall.updateSkill(cwd, "local-skill", "# Updated\n").ok, true);
      assert.equal(panelInstall.toggleSkill(cwd, "local-skill", false).active, false);
      assert.equal(panelInstall.listSkills(cwd)[0].active, false);
      assert.equal(panelInstall.toggleSkill(cwd, "local-skill", true).active, true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("installs a named skill from the fxmind catalog", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxcatalog-"));
    try {
      fs.mkdirSync(path.join(cwd, ".fxmind"), { recursive: true });
      const result = panelInstall.installSkillFromCatalog(cwd, "fivem/fivem-development");
      assert.equal(result.ok, true);
      assert.equal(result.name, "fivem-development");
      assert.equal(result.origin, "fivem");
      assert.equal(fs.existsSync(path.join(cwd, ".fxmind", "skills", "fivem-development", "SKILL.md")), true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("runs the panel installer for a newly selected agent", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxpanel-install-"));
    try {
      const result = await panelInstall.runInstall(cwd, {
        packs: ["fivem"],
        agents: ["codex"],
        noHooks: true,
        noMcp: true,
      });
      assert.equal(result.ok, true, result.log);
      assert.deepEqual(result.setup.agents, ["codex"]);
      assert.equal(
        fs.existsSync(path.join(cwd, ".agents", "skills", "fxmind", "SKILL.md")),
        true,
      );
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
