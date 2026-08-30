const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panelContext = require("./panel-context");
const tools = require("../fxmind-tools");

describe("panel-context", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fxctx-"));
    const fxmind = path.join(tmpDir, ".fxmind");
    fs.mkdirSync(path.join(fxmind, "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(fxmind, "memory", "_index.md"),
      "# index\n- radio\n",
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inject PANEL_MODE quick block", () => {
    const body = panelContext.buildContextFile(tmpDir, "fix radio", { taskMode: "quick" });
    assert.match(body, /PANEL_MODE: quick/);
    assert.match(body, /trivial: true/);
  });

  it("inject PANEL_MODE full block", () => {
    const body = panelContext.buildContextFile(tmpDir, "fix radio", { taskMode: "full" });
    assert.match(body, /PANEL_MODE: full/);
    assert.match(body, /Ferramentas FxMind/);
    assert.match(body, /fxmind_query/);
    assert.match(body, /Proibido.*grep/);
  });

  it("normalizeTaskMode defaults unknown to full", () => {
    assert.equal(panelContext.normalizeTaskMode("quick"), "quick");
    assert.equal(panelContext.normalizeTaskMode("full"), "full");
    assert.equal(panelContext.normalizeTaskMode(undefined), "full");
  });

  it("queryGraph rebuild:false does not create graph file when missing", () => {
    const result = tools.queryGraph(tmpDir, "radio safezone", { rebuild: false });
    assert.equal(result.ok, false);
    assert.match(result.error, /Missing knowledge-graph/);
  });

  it("writeContextTemp writes temp file with panel mode", () => {
    const file = panelContext.writeContextTemp(tmpDir, "hello", "thread-1", {
      taskMode: "quick",
    });
    assert.ok(fs.existsSync(file));
    const body = fs.readFileSync(file, "utf8");
    assert.match(body, /PANEL_MODE: quick/);
    fs.unlinkSync(file);
  });
});
