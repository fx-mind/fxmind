const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  cleanupFxmindTmp,
  shouldRetainFxmindTmp,
} = require("./cleanup-tmp");
const { ensureProjectGitignore } = require("../fxmind-tools");

describe("cleanup-tmp", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxclean-"));
    fs.mkdirSync(path.join(dir, ".fxmind"), { recursive: true });
  });

  it("removes tmp when no gates file", () => {
    const tmp = path.join(dir, ".fxmind", "tmp", "scratch.txt");
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, "x", "utf8");
    const result = cleanupFxmindTmp(dir);
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(path.dirname(tmp)), false);
  });

  it("retains tmp while task active before Gate C", () => {
    fs.writeFileSync(
      path.join(dir, ".fxmind", "fxmind-gates.json"),
      JSON.stringify({
        taskActive: true,
        gates: { A: { complete: true }, B: { complete: true }, C: { complete: false } },
      }),
      "utf8",
    );
    const tmpDir = path.join(dir, ".fxmind", "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    assert.equal(shouldRetainFxmindTmp(dir), true);
    const result = cleanupFxmindTmp(dir);
    assert.equal(result.removed, false);
    assert.equal(result.retained, true);
    assert.ok(fs.existsSync(tmpDir));
  });

  it("removes tmp after Gate C", () => {
    fs.writeFileSync(
      path.join(dir, ".fxmind", "fxmind-gates.json"),
      JSON.stringify({
        taskActive: true,
        gates: { C: { complete: true } },
      }),
      "utf8",
    );
    const tmpDir = path.join(dir, ".fxmind", "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    assert.equal(shouldRetainFxmindTmp(dir), false);
    const result = cleanupFxmindTmp(dir);
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(tmpDir), false);
  });
});

describe("ensureProjectGitignore tmp", () => {
  it("adds .fxmind/state/ gitignore line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxgi-"));
    const result = ensureProjectGitignore(dir);
    assert.ok(result.added.includes(".fxmind/state/"));
    assert.ok(result.added.includes(".fxmind/graph/"));
    assert.ok(result.added.includes(".fxmind/tmp/"));
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.match(content, /\.fxmind\/state\//);
    assert.match(content, /\.fxmind\/graph\//);
    assert.match(content, /\.fxmind\/tmp\//);
  });

  it("untracks generated graph/state files and keeps memories tracked", () => {
    const { execFileSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxgi-git-"));
    fs.mkdirSync(path.join(dir, ".fxmind", "graph"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".fxmind", "state"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".fxmind", "memory"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".fxmind", "graph", "knowledge-graph.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(dir, ".fxmind", "graph", "memory-index.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(dir, ".fxmind", "state", "graph-cache.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(dir, ".fxmind", "state", "metrics.jsonl"), "{}\n", "utf8");
    fs.writeFileSync(path.join(dir, ".fxmind", "memory", "permissions.md"), "# mem\n", "utf8");

    execFileSync("git", ["init", "-q"], { cwd: dir, windowsHide: true });
    execFileSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });

    const result = ensureProjectGitignore(dir);
    assert.ok(result.untracked.some((file) => file.includes("knowledge-graph.json")));
    assert.ok(result.untracked.some((file) => file.includes("memory-index.json")));
    assert.ok(result.untracked.some((file) => file.includes("graph-cache.json")));
    assert.ok(result.untracked.some((file) => file.includes("metrics.jsonl")));

    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    })
      .split("\0")
      .map((entry) => entry.replace(/\\/g, "/"))
      .filter(Boolean);

    assert.ok(tracked.some((file) => file.endsWith(".fxmind/memory/permissions.md") || file === ".fxmind/memory/permissions.md"));
    assert.equal(tracked.some((file) => file.includes("knowledge-graph.json")), false);
    assert.equal(tracked.some((file) => file.includes("memory-index.json")), false);
    assert.equal(tracked.some((file) => file.includes("graph-cache.json")), false);
    assert.equal(tracked.some((file) => file.includes("metrics.jsonl")), false);
    assert.ok(fs.existsSync(path.join(dir, ".fxmind", "memory", "permissions.md")));
    assert.ok(fs.existsSync(path.join(dir, ".fxmind", "graph", "knowledge-graph.json")));
  });
});
