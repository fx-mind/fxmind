const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildGraphData,
  writeGraph,
  inferLinks,
  resourceFromPath,
  syncKnowledgeGraphHtml,
  GRAPH_CACHE_FILE,
} = require("./build-graph");
const { isGraphStale, ensureGraphFresh } = require("./lib/graph-freshness");

function writeMinimalProject(root) {
  const fx = path.join(root, ".fxmind");
  const mem = path.join(fx, "memory");
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(
    path.join(mem, "alpha.md"),
    `---
topic: alpha
updated: 2026-01-01
lang: en-compact
paths:
  - resources/alpha/server.lua
triggers:
  - alpha
events:
  - alpha:run
exports:
  - doAlpha
resources:
  - alpha-res
---
Alpha body mentions beta sometimes.
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(mem, "beta.md"),
    `---
topic: beta
updated: 2026-01-01
lang: en-compact
paths:
  - resources/beta/client.lua
triggers:
  - beta
events:
  - alpha:run
exports:
  - doBeta
resources:
  - alpha-res
---
Beta references alpha id in text.
`,
    "utf8",
  );
  fs.mkdirSync(path.join(fx, "policy"), { recursive: true });
  fs.writeFileSync(path.join(fx, "policy", "topic-catalog.md"), "| Tópico | Triggers | Hints |\n|---|---|---|\n", "utf8");
  fs.mkdirSync(path.join(fx, "graph"), { recursive: true });
  fs.writeFileSync(path.join(fx, "graph", "knowledge-graph.html"), "<html>const GRAPH_DATA = /*__GRAPH_DATA__*/;</html>", "utf8");
}

describe("inferLinks", () => {
  it("links shared events, resources, paths, and mentions", () => {
    const nodes = [
      {
        id: "alpha",
        triggers: "alpha",
        paths: "resources/alpha/server.lua",
        _content: "alpha beta shared",
        _paths: ["resources/alpha/server.lua"],
        _events: ["alpha:run"],
        _resources: ["alpha-res"],
        _exports: ["doAlpha"],
        _symbols: [],
      },
      {
        id: "beta",
        triggers: "beta",
        paths: "resources/beta/client.lua",
        _content: "mentions alpha here",
        _paths: ["resources/beta/client.lua"],
        _events: ["alpha:run"],
        _resources: ["alpha-res"],
        _exports: ["doBeta"],
        _symbols: [],
      },
    ];
    const links = inferLinks(nodes);
    const types = new Set(links.map((l) => l.type));
    assert.ok(types.has("event-flow"));
    assert.equal(links.length, 1);
  });

  it("links different events from the same event domain", () => {
    const links = inferLinks([
      {
        id: "cacheaside",
        _content: "",
        _events: ["garages:user_vehicles"],
        _resources: ["cacheaside"],
        _paths: ["resources/[system]/cacheaside/"],
        _exports: [],
        _symbols: [],
      },
      {
        id: "garage",
        _content: "",
        _events: ["garages:OpenGarage", "garages:Spawn"],
        _resources: ["garages"],
        _paths: ["resources/[novos]/garages/"],
        _exports: [],
        _symbols: [],
      },
    ]);
    assert.deepEqual(links, [
      {
        source: "cacheaside",
        target: "garage",
        type: "event-domain",
        confidence: "inferred",
      },
    ]);
  });

  it("does not link generic event namespaces", () => {
    const links = inferLinks([
      {
        id: "first",
        _content: "",
        _events: ["player:connected"],
        _resources: [],
        _paths: [],
        _exports: [],
        _symbols: [],
      },
      {
        id: "second",
        _content: "",
        _events: ["player:dropped"],
        _resources: [],
        _paths: [],
        _exports: [],
        _symbols: [],
      },
    ]);
    assert.deepEqual(links, []);
  });

  it("does not treat resource categories as shared resources", () => {
    const links = inferLinks([
      { id: "admin", _content: "", _events: [], _resources: ["[scripts]"], _paths: [], _exports: [], _symbols: [] },
      { id: "hud", _content: "", _events: [], _resources: ["[scripts]"], _paths: [], _exports: [], _symbols: [] },
    ]);
    assert.deepEqual(links, []);
  });

  it("keeps links between concrete shared resources", () => {
    const links = inferLinks([
      { id: "voice", _content: "", _events: [], _resources: ["hud"], _paths: [], _exports: [], _symbols: [] },
      { id: "hud", _content: "", _events: [], _resources: ["hud"], _paths: [], _exports: [], _symbols: [] },
    ]);
    assert.deepEqual(links.map((link) => link.type), ["shared-resource"]);
  });

  it("does not infer shared paths from prose fragments", () => {
    const first = {
      id: "first",
      _content: "",
      _events: [],
      _resources: [],
      _paths: ["lua", "resources/[scripts]/first/core.lua"],
      _exports: [],
      _symbols: [],
    };
    const second = {
      id: "second",
      _content: "",
      _events: [],
      _resources: [],
      _paths: ["lua", "resources/[scripts]/second/core.lua"],
      _exports: [],
      _symbols: [],
    };
    assert.deepEqual(inferLinks([first, second]), []);
  });

  it("extracts the concrete resource after category folders", () => {
    assert.equal(resourceFromPath("resources/[scripts]/admin/server-side/core.lua"), "admin");
    assert.equal(
      resourceFromPath("resources/[system]/[dependecias]/cerberus/config/config.lua"),
      "cerberus",
    );
    assert.equal(resourceFromPath("resources/[system]/config/vehicles_export.lua"), null);
  });
});

describe("graph cache", () => {
  it("writes graph-cache.json on build with useCache", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-"));
    writeMinimalProject(dir);
    const graph = buildGraphData(dir, { useCache: true });
    const cachePath = path.join(dir, ".fxmind", "state", "graph-cache.json");
    assert.ok(fs.existsSync(cachePath));
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    assert.ok(cache.files.alpha);
    assert.ok(cache.files.beta);
    assert.equal(cache.files.alpha.node._content, undefined);
    assert.equal(graph.nodes.find((node) => node.id === "alpha").events, "alpha:run");
    assert.equal(graph.nodes.find((node) => node.id === "alpha").resources, "alpha-res, alpha");
  });
});

describe("writeGraph updateHtml", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-"));
    writeMinimalProject(dir);
  });

  it("skips HTML when updateHtml is false", () => {
    const htmlPath = path.join(dir, ".fxmind", "graph", "knowledge-graph.html");
    const before = fs.readFileSync(htmlPath, "utf8");
    const data = buildGraphData(dir);
    writeGraph(dir, data, { updateHtml: false });
    const after = fs.readFileSync(htmlPath, "utf8");
    assert.equal(before, after);
    assert.ok(fs.existsSync(path.join(dir, ".fxmind", "graph", "knowledge-graph.json")));
  });

  it("syncs HTML when updateHtml is true", () => {
    const data = buildGraphData(dir);
    writeGraph(dir, data, { updateHtml: true });
    const html = fs.readFileSync(path.join(dir, ".fxmind", "graph", "knowledge-graph.html"), "utf8");
    assert.match(html, /"nodes"/);
  });

  it("returns false when HTML template is missing", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-bare-"));
    fs.mkdirSync(path.join(bare, ".fxmind"), { recursive: true });
    const data = buildGraphData(dir);
    assert.equal(syncKnowledgeGraphHtml(bare, data), false);
  });
});

describe("isGraphStale / ensureGraphFresh", () => {
  it("detects stale when memory is newer than graph json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-"));
    writeMinimalProject(dir);
    assert.equal(isGraphStale(dir), true);
    ensureGraphFresh(dir, { updateHtml: false });
    assert.equal(isGraphStale(dir), false);
    const memFile = path.join(dir, ".fxmind", "memory", "alpha.md");
    fs.appendFileSync(memFile, "\n<!-- touch -->\n");
    assert.equal(isGraphStale(dir), true);
  });

  it("debounces rebuild when graph was built recently", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-deb-"));
    writeMinimalProject(dir);
    ensureGraphFresh(dir, { updateHtml: false });
    const memFile = path.join(dir, ".fxmind", "memory", "alpha.md");
    fs.appendFileSync(memFile, "\n<!-- touch -->\n");
    assert.equal(isGraphStale(dir), true);
    const result = ensureGraphFresh(dir, { updateHtml: false });
    assert.equal(result.debounced, true);
    assert.equal(result.rebuilt, false);
  });
});
