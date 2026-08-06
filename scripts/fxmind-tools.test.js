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
  fs.writeFileSync(path.join(fx, "topic-catalog.md"), "| Tópico | Triggers | Hints |\n|---|---|---|\n", "utf8");
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
    assert.ok(fs.existsSync(path.join(dir, ".fxmind", "knowledge-graph.json")));
    assert.ok(result.memories !== undefined || result.expanded !== undefined);
  });
});
