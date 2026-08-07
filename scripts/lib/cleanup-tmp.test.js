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
  it("adds .fxmind/tmp/ line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxgi-"));
    const result = ensureProjectGitignore(dir);
    assert.ok(result.added.includes(".fxmind/tmp/"));
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.match(content, /\.fxmind\/tmp\//);
  });
});
