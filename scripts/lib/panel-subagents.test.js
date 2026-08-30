const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panel = require("./panel-api");
const subagents = require("./panel-subagents");
const { installOpenCodeSubagents } = require("../install/opencode");

describe("panel-subagents", () => {
  let tmpHome;
  let projectRoot;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxsub-home-"));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fxsub-proj-"));
    if (process.platform === "win32") {
      process.env.USERPROFILE = tmpHome;
    } else {
      process.env.HOME = tmpHome;
    }
  });

  afterEach(() => {
    if (process.platform === "win32") {
      delete process.env.USERPROFILE;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns defaults when opencode is not installed", () => {
    const result = subagents.getSubagentSettings(projectRoot);
    assert.equal(result.ok, true);
    assert.equal(result.installed, false);
    assert.equal(result.subagents.length, 4);
    assert.equal(result.subagents[0].model, null);
  });

  it("installs and persists subagent models", () => {
    installOpenCodeSubagents(projectRoot);
    const saved = subagents.putSubagentSettings(projectRoot, {
      subagents: {
        explore: { model: "composer-2.5-fast", variant: "minimal" },
        reader: { model: "composer-2.5-fast" },
      },
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.installed, true);
    assert.equal(saved.subagents.find((a) => a.id === "explore")?.model, "composer-2.5-fast");

    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8"));
    assert.equal(config.agent.explore.model, "composer-2.5-fast");
    assert.equal(config.agent.explore.variant, "minimal");

    const panelCfg = JSON.parse(fs.readFileSync(panel.panelConfigPath(), "utf8"));
    assert.equal(panelCfg.agent.subagents.explore.model, "composer-2.5-fast");
  });

  it("persists a per-subagent cliId independent of the primary provider", () => {
    const saved = subagents.putSubagentSettings(projectRoot, {
      subagents: {
        explore: { model: "claude-model", cliId: "claude" },
        general: { cliId: "codex" },
      },
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.subagents.find((a) => a.id === "explore")?.cliId, "claude");
    assert.equal(saved.subagents.find((a) => a.id === "general")?.cliId, "codex");
    // Unset subagents keep no cliId (falls back to "automatic" at run time).
    assert.equal(saved.subagents.find((a) => a.id === "reader")?.cliId, null);

    // cliId is a panel-only concept — OpenCode has no notion of "run this
    // subagent on a different CLI", so it must never leak into opencode.json.
    installOpenCodeSubagents(projectRoot);
    subagents.putSubagentSettings(projectRoot, {
      subagents: { explore: { model: "claude-model", cliId: "claude" } },
    });
    const opencodeConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8"),
    );
    assert.equal("cliId" in opencodeConfig.agent.explore, false);
  });
});
