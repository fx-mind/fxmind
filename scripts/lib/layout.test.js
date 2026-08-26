const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  REL,
  LAYOUT_VERSION,
  fxmindDir,
  writeLocal,
  resolveLocal,
  migrateLayoutInDir,
  migrateProjectLayout,
} = require("./layout");

describe("layout v3", () => {
  it("exposes layout version 3", () => {
    assert.equal(LAYOUT_VERSION, 3);
    assert.equal(REL.graphJson, "graph/knowledge-graph.json");
    assert.equal(REL.gates, "state/fxmind-gates.json");
  });

  it("migrates flat-root files into folders", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlayout-"));
    const fx = path.join(dir, ".fxmind");
    fs.mkdirSync(fx, { recursive: true });
    fs.writeFileSync(path.join(fx, "failure-modes.md"), "fm\n", "utf8");
    fs.writeFileSync(path.join(fx, "topic-catalog.md"), "cat\n", "utf8");
    fs.writeFileSync(path.join(fx, "knowledge-graph.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(fx, "fxmind-gates.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(fx, "memory.template.md"), "tpl\n", "utf8");
    fs.writeFileSync(path.join(fx, "audit-procedure.md"), "proc\n", "utf8");
    fs.writeFileSync(path.join(fx, "audit.template.md"), "deprecated\n", "utf8");
    fs.writeFileSync(path.join(fx, "mcp-launch.js"), "console.log(1)\n", "utf8");

    const moved = migrateProjectLayout(dir);
    assert.ok(moved.length >= 6);
    assert.equal(fs.readFileSync(path.join(fx, "policy", "failure-modes.md"), "utf8"), "fm\n");
    assert.equal(fs.readFileSync(path.join(fx, "policy", "topic-catalog.md"), "utf8"), "cat\n");
    assert.equal(fs.readFileSync(path.join(fx, "graph", "knowledge-graph.json"), "utf8"), "{}\n");
    assert.equal(fs.readFileSync(path.join(fx, "state", "fxmind-gates.json"), "utf8"), "{}\n");
    assert.equal(fs.readFileSync(path.join(fx, "templates", "memory.md"), "utf8"), "tpl\n");
    assert.equal(fs.readFileSync(path.join(fx, "audits", "procedure.md"), "utf8"), "proc\n");
    assert.equal(fs.existsSync(path.join(fx, "audit.template.md")), false);
    assert.equal(fs.existsSync(path.join(fx, "mcp-launch.js")), false);
    assert.equal(fs.existsSync(path.join(fx, "failure-modes.md")), false);

    const again = migrateLayoutInDir(fx);
    assert.equal(again.length, 0);
  });

  it("resolves legacy paths until migration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlayout-"));
    const fx = fxmindDir(dir);
    fs.mkdirSync(fx, { recursive: true });
    fs.writeFileSync(path.join(fx, "topic-catalog.md"), "old\n", "utf8");
    assert.equal(resolveLocal(dir, "topicCatalog"), path.join(fx, "topic-catalog.md"));
    assert.equal(writeLocal(dir, "topicCatalog"), path.join(fx, "policy", "topic-catalog.md"));
  });
});
