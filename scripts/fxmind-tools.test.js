const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tools = require("./fxmind-tools");
const { isGraphStale } = require("./lib/graph-freshness");

function writeMinimalProject(root) {
  const fx = path.join(root, ".fxmind");
  const mem = path.join(fx, "memory");
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(
    path.join(mem, "craft.md"),
    `---
topic: craft
updated: 2026-01-01
lang: en-compact
paths: [resources/craft/server.lua]
triggers: [craft, crafting]
---
Craft system handler craft recipe items.
`,
    "utf8",
  );
  fs.mkdirSync(path.join(fx, "policy"), { recursive: true });
  fs.writeFileSync(path.join(fx, "policy", "topic-catalog.md"), "| Tópico | Triggers | Hints |\n|---|---|---|\n", "utf8");
}

describe("queryGraph auto-rebuild", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxtools-"));
    writeMinimalProject(dir);
  });

  it("rebuilds missing graph and returns query results", () => {
    assert.equal(isGraphStale(dir), true);
    const result = tools.queryGraph(dir, "craft recipe");
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(path.join(dir, ".fxmind", "graph", "knowledge-graph.json")));
    assert.ok(result.memories !== undefined || result.expanded !== undefined);
  });

  it("bounds large memories by the requested estimated token budget", () => {
    fs.appendFileSync(path.join(dir, ".fxmind", "memory", "craft.md"), "craft rule ".repeat(3000));
    const result = tools.queryGraph(dir, "craft", { budget: 25 });
    assert.equal(result.ok, true);
    assert.ok(result.tokensUsed <= 25);
    assert.ok(result.memories[0].truncated);
    assert.ok(result.memories[0].content.length <= 100);
    assert.match(result.memories[0].content, /^Paths: resources\/craft\/server\.lua/);
    assert.ok(fs.existsSync(result.memories[0].file));
  });
});
