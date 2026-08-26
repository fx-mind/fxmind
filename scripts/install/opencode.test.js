const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  installOpenCodeSubagents,
  uninstallOpenCodeSubagents,
  mergeOpenCodeSubagentConfig,
} = require("./opencode");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-opencode-"));
}

describe("OpenCode subagents", () => {
  it("copies explore/reader/general/scout and delegate-io", () => {
    const root = tmpProject();
    const installed = installOpenCodeSubagents(root);

    assert.ok(installed.includes(".opencode/agents/explore.md"));
    assert.ok(installed.includes(".opencode/agents/reader.md"));
    assert.ok(installed.includes(".opencode/agents/general.md"));
    assert.ok(installed.includes(".opencode/agents/scout.md"));
    assert.ok(installed.includes(".opencode/instructions/delegate-io.md"));

    const explore = fs.readFileSync(path.join(root, ".opencode", "agents", "explore.md"), "utf8");
    assert.match(explore, /mode: subagent/);
    assert.match(explore, /\.fxmind\/memory\//);
    assert.doesNotMatch(explore, /TxdBase/);

    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    assert.deepEqual(config.instructions, [".opencode/instructions/delegate-io.md"]);
    assert.equal(config.agent.explore.mode, "subagent");
    assert.equal(config.agent.reader.mode, "subagent");
    assert.equal(config.agent.general.mode, "subagent");
    assert.equal(config.agent.scout.mode, "subagent");
  });

  it("preserves existing mcp entry and agent models", () => {
    const root = tmpProject();
    fs.writeFileSync(
      path.join(root, "opencode.json"),
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            fxmind: { type: "local", command: ["fxmind-mcp"], enabled: true },
          },
          agent: {
            explore: { mode: "subagent", model: "opencode/nemotron-3.5-lightning-free" },
            build: { mode: "primary" },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    mergeOpenCodeSubagentConfig(root);
    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    assert.equal(config.mcp.fxmind.command[0], "fxmind-mcp");
    assert.equal(config.agent.explore.model, "opencode/nemotron-3.5-lightning-free");
    assert.equal(config.agent.explore.mode, "subagent");
    assert.equal(config.agent.build.mode, "primary");
    assert.equal(config.agent.reader.mode, "subagent");
    assert.deepEqual(config.instructions, [".opencode/instructions/delegate-io.md"]);
  });

  it("uninstall removes managed agents and instruction without dropping mcp", () => {
    const root = tmpProject();
    installOpenCodeSubagents(root);
    const configPath = path.join(root, "opencode.json");
    const before = JSON.parse(fs.readFileSync(configPath, "utf8"));
    before.mcp = { fxmind: { type: "local", command: ["fxmind-mcp"], enabled: true } };
    before.agent.build = { mode: "primary" };
    fs.writeFileSync(configPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    const removed = uninstallOpenCodeSubagents(root);
    assert.ok(removed.includes(".opencode/agents/scout.md"));
    assert.equal(fs.existsSync(path.join(root, ".opencode", "agents", "explore.md")), false);
    assert.equal(fs.existsSync(path.join(root, ".opencode", "instructions", "delegate-io.md")), false);

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.mcp.fxmind.enabled, true);
    assert.equal(config.agent.build.mode, "primary");
    assert.equal(config.agent.explore, undefined);
    assert.equal(config.instructions, undefined);
  });
});
