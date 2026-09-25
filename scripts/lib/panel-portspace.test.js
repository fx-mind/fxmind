const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const portspace = require("./panel-portspace");

function writeConfig(home, portspaceConfig) {
  const configPath = path.join(home, ".fxmind", "panel.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ version: 1, portspace: portspaceConfig }), "utf8");
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("panel-portspace", () => {
  let tmpHome;
  let originalHome;
  let originalFetch;
  let calls;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxportspace-"));
    originalHome = process.env.USERPROFILE || process.env.HOME;
    if (process.platform === "win32") process.env.USERPROFILE = tmpHome;
    else process.env.HOME = tmpHome;
    originalFetch = global.fetch;
    calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true }),
      };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (process.platform === "win32") process.env.USERPROFILE = originalHome;
    else process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("isPortspaceCard only accepts PortSpace items with a card id", () => {
    assert.equal(portspace.isPortspaceCard({ source: "portspace", cardId: "c1" }), true);
    assert.equal(portspace.isPortspaceCard({ source: "trello", cardId: "c1" }), false);
    assert.equal(portspace.isPortspaceCard({ source: "portspace" }), false);
  });

  it("claimCard is a no-op error when PortSpace is not configured", async () => {
    const result = await portspace.claimCard("c1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "not_configured");
    assert.equal(calls.length, 0);
  });

  it("claimCard posts with the integration key", async () => {
    writeConfig(tmpHome, { baseUrl: "https://api.example.com/", integrationKey: "key-123" });
    const result = await portspace.claimCard("card 1");
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, "https://api.example.com/external/fxmind/cards/card%201/claim");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["x-integration-key"], "key-123");
  });

  it("surfaces the upstream message on a refused claim", async () => {
    writeConfig(tmpHome, { baseUrl: "https://api.example.com", integrationKey: "key-123" });
    global.fetch = async () => ({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () => JSON.stringify({ message: "Este card já foi assumido por outra pessoa" }),
    });
    const result = await portspace.claimCard("c1");
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    const sync = portspace.syncResult("claim", result);
    assert.equal(sync.error, "Este card já foi assumido por outra pessoa");
  });

  it("publicRepoUrl strips credentials and converts ssh remotes", () => {
    assert.equal(
      portspace.publicRepoUrl("https://user:token@github.com/acme/app.git"),
      "https://github.com/acme/app",
    );
    assert.equal(portspace.publicRepoUrl("git@github.com:acme/app.git"), "https://github.com/acme/app");
    assert.equal(portspace.publicRepoUrl("file:///tmp/repo"), null);
    assert.equal(portspace.publicRepoUrl(""), null);
  });

  it("completeThreadCard sends the pushed HEAD, branch and repo url", async () => {
    writeConfig(tmpHome, { baseUrl: "https://api.example.com", integrationKey: "key-123" });
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fxportspace-repo-"));
    try {
      git(["init", "-q"], repo);
      git(["config", "user.email", "t@example.com"], repo);
      git(["config", "user.name", "Test"], repo);
      git(["remote", "add", "origin", "https://x:secret@github.com/acme/app.git"], repo);
      fs.writeFileSync(path.join(repo, "a.txt"), "a");
      git(["add", "."], repo);
      git(["commit", "-q", "-m", "feat: a"], repo);
      const head = git(["rev-parse", "HEAD"], repo);

      const sync = await portspace.completeThreadCard(
        {
          cardId: "c1",
          cardSource: "portspace",
          projectRoot: repo,
          title: "Demanda",
          commits: [{ hash: "0000000", message: "feat: a", branch: "task/x" }],
        },
        { branch: "task/x", remote: "origin" },
      );
      assert.equal(sync.ok, true);
      assert.equal(sync.action, "complete");
      const body = JSON.parse(calls[0].init.body);
      assert.equal(calls[0].url, "https://api.example.com/external/fxmind/cards/c1/complete");
      assert.equal(body.commitSha, head);
      assert.equal(body.branch, "task/x");
      assert.equal(body.commitMessage, "feat: a");
      assert.equal(body.repoUrl, "https://github.com/acme/app");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("completeThreadCard ignores threads that are not PortSpace cards", async () => {
    assert.equal(await portspace.completeThreadCard({ cardId: "c1", cardSource: "trello" }), null);
    assert.equal(await portspace.completeThreadCard({ cardSource: "portspace" }), null);
    assert.equal(calls.length, 0);
  });
});
