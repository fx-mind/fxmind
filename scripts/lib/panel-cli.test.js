const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panelCli = require("./panel-cli");
const panel = require("./panel-api");
const threads = require("./panel-threads");

describe("panel-cli", () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxcli-"));
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
  });

  it("scanCli returns catalog entries", () => {
    const clis = panelCli.scanCli();
    assert.ok(clis.length >= 5);
    assert.ok(clis.some((c) => c.id === "opencode"));
    assert.ok(clis.some((c) => c.id === "codex"));
    assert.ok(clis.every((c) => "installed" in c && "status" in c));
  });

  it("getAgentSettings defaults to cli mode", () => {
    const settings = panelCli.getAgentSettings();
    assert.equal(settings.mode, "cli");
    assert.ok(!JSON.stringify(settings).includes("sk-"));
  });

  it("putAgentSettings persists cliId without raw keys in response", () => {
    const saved = panelCli.putAgentSettings({
      cliId: "opencode",
      anthropicKey: "sk-ant-test-key-1234567890",
    });
    assert.equal(saved.cliId, "opencode");
    assert.equal(saved.byok.anthropic, true);
    assert.ok(!JSON.stringify(saved).includes("sk-ant-test"));

    const raw = JSON.parse(fs.readFileSync(panel.panelConfigPath(), "utf8"));
    assert.equal(raw.agent.cliId, "opencode");
    assert.equal(raw.byok.anthropic, "sk-ant-test-key-1234567890");
  });

  it("putAgentSettings persists taskMode", () => {
    const saved = panelCli.putAgentSettings({ taskMode: "quick" });
    assert.equal(saved.taskMode, "quick");
    const again = panelCli.getAgentSettings();
    assert.equal(again.taskMode, "quick");
  });

  it("transcript truncates older messages", () => {
    const messages = [];
    for (let i = 0; i < 12; i += 1) {
      messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` });
    }
    const out = panelCli.transcript({ messages }, { maxMessages: 4 });
    assert.match(out, /8 earlier message/);
    assert.match(out, /msg 11/);
  });

  it("pickCliId respects explicit unavailable id fallback", () => {
    const picked = panelCli.pickCliId("nonexistent-cli");
    assert.ok(picked === null || typeof picked === "string");
  });

  it("listCliModels returns enriched model entries", () => {
    const result = panelCli.listCliModels("claude", { all: true });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.models));
    if (result.models.length) {
      assert.ok("id" in result.models[0]);
      assert.ok("enabled" in result.models[0]);
    }
    assert.ok(result.effort);
  });

  it("stops a host-running thread when no child process exists", () => {
    threads._resetForTests();
    const { thread } = threads.injectDemand({ item: { title: "Stop" } });
    threads.setRunning(thread.id, { cliId: "cursor-agent" });
    const result = panelCli.stopThread(thread.id);
    assert.equal(result.ok, true);
    assert.equal(result.thread.status, "error");
    assert.match(result.thread.error, /interrompida/i);
    threads._resetForTests();
  });

  it("pauses a running thread without reporting an error", () => {
    threads._resetForTests();
    const { thread } = threads.injectDemand({ item: { title: "Pause" } });
    threads.setRunning(thread.id, { cliId: "codex" });
    const result = panelCli.pauseThread(thread.id);
    assert.equal(result.ok, true);
    assert.equal(result.thread.status, "paused");
    assert.equal(result.thread.error, null);
    threads._resetForTests();
  });

  it("commits changes directly when a thread has no worktree", () => {
    threads._resetForTests();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fxcli-repo-"));
    try {
      execFileSync("git", ["init", "-q", repo], { windowsHide: true });
      fs.writeFileSync(path.join(repo, "README.md"), "base\n", "utf8");
      execFileSync("git", ["-C", repo, "add", "README.md"], { windowsHide: true });
      execFileSync(
        "git",
        [
          "-C",
          repo,
          "-c",
          "user.name=fxmind-test",
          "-c",
          "user.email=fxmind@example.test",
          "commit",
          "-qm",
          "base",
        ],
        { windowsHide: true },
      );

      const { thread } = threads.createThread({
        projectRoot: repo,
        title: "Direct change",
        content: "change the readme",
      });
      fs.writeFileSync(path.join(repo, "README.md"), "changed\n", "utf8");
      threads.setPhase(thread.id, "review");

      const result = panelCli.commitThread(thread.id, { message: "direct change" });
      assert.equal(result.ok, true);
      assert.equal(result.thread.worktree, null);
      assert.equal(
        execFileSync("git", ["-C", repo, "log", "-1", "--pretty=%s"], {
          encoding: "utf8",
          windowsHide: true,
        }).trim(),
        "direct change",
      );
    } finally {
      threads._resetForTests();
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  describe("subagents (cross-provider, no CLI spawned)", () => {
    it("marks explore/reader/scout read-only from their template's permission block", () => {
      const explore = panelCli.readSubagentPersona("explore");
      assert.equal(explore.denyEdit, true);
      assert.equal(explore.denyBash, true);
      assert.match(explore.body, /discovery specialist/i);

      const reader = panelCli.readSubagentPersona("reader");
      assert.equal(reader.denyEdit, true);

      const scout = panelCli.readSubagentPersona("scout");
      assert.equal(scout.denyEdit, true);
    });

    it("does not force read-only on the general subagent (it's a bounded implementer)", () => {
      const general = panelCli.readSubagentPersona("general");
      assert.equal(general.denyEdit, false);
      assert.equal(general.denyBash, false);
      assert.match(general.body, /implementer/i);
    });

    it("returns null for an unknown subagent id instead of throwing", () => {
      assert.equal(panelCli.readSubagentPersona("does-not-exist"), null);
    });

    it("reads the per-subagent cliId/model from panel config, independent of the primary provider", () => {
      panelCli.putAgentSettings({ cliId: "opencode" });
      panelCli.putAgentSettings({
        subagents: { explore: { model: "claude-model", cliId: "claude" } },
      });
      const cfg = panelCli.subagentConfigFor("explore");
      assert.equal(cfg.cliId, "claude");
      assert.equal(cfg.model, "claude-model");
      assert.equal(panelCli.subagentConfigFor("reader").cliId, null);
    });

    it("builds the subagent's prompt body from its persona, the task, and known paths", () => {
      const persona = panelCli.readSubagentPersona("reader");
      const body = panelCli.buildSubagentBody("reader", persona, {
        prompt: "What does foo() do?",
        paths: ["src/foo.js", "src/bar.js"],
      });
      assert.match(body, /FxMind subagent: reader/);
      assert.match(body, /fast file reader/i);
      assert.match(body, /What does foo\(\) do\?/);
      assert.match(body, /src\/foo\.js/);
      assert.match(body, /src\/bar\.js/);
    });

    it("falls back to a generic persona for a custom subagent id with no template file", () => {
      const body = panelCli.buildSubagentBody("custom-role", null, { prompt: "Do X" });
      assert.match(body, /You are the "custom-role" subagent/);
      assert.match(body, /Do X/);
    });
  });
});
