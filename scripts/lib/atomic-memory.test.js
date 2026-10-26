"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const atomic = require("./atomic-memory");
const tools = require("../fxmind-tools");

let root;
const source = "resources/[ecco]/garages/server.lua";
const memory = ".fxmind/memory/garages.md";
const body = [
  'RegisterNetEvent("garages:store")',
  "local function canStoreVehicle(userId, plate)",
  "  if not userId or not plate then return false end",
  "  return true",
  "end",
  'RegisterNetEvent("garages:retrieve")',
  "function retrieveVehicle(plate)",
  "  return plate",
  "end",
  "",
].join("\n");
const note = [
  "---",
  "topic: garages",
  "updated: 2026-10-26",
  "lang: en-compact",
  "paths: [resources/[ecco]/garages/server.lua]",
  "symbols: [canStoreVehicle, retrieveVehicle]",
  "triggers: [garages, guardar veiculo, retirar veiculo]",
  "---",
  "# garages",
  "## Guardar veículo",
  "Guardar veículo valida placa e proprietário pelo evento garages:store.",
  "",
  "## Retirar veículo",
  "Retirar veículo usa o evento garages:retrieve e a função retrieveVehicle.",
  "",
  "## Multas",
  "A multa de apreensão deve ser verificada antes de liberar.",
  "",
].join("\n");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fxatomic-"));
  fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
  fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, source), body);
  fs.writeFileSync(path.join(root, memory), note);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("atomic graph and memory", () => {
  it("indexes code, events, and one memory fact per section without modifying notes", () => {
    const before = fs.readFileSync(path.join(root, memory), "utf8");
    const graph = atomic.buildAtomic(root);
    assert.ok(graph.nodes.some((n) => n.kind === "function" && n.name === "canStoreVehicle"));
    assert.ok(graph.nodes.some((n) => n.kind === "event" && n.name === "garages:store"));
    assert.ok(graph.nodes.some((n) => n.group === "memory-atom" && n.content.includes("placa")));
    assert.ok(graph.links.some((edge) => edge.type === "belongs-to"));
    assert.ok(graph.links.some((edge) => edge.type === "references-symbol"));
    assert.equal(fs.readFileSync(path.join(root, memory), "utf8"), before);
  });

  it("returns only relevant fragments, not the whole garage.md", () => {
    atomic.buildAtomic(root);
    const answer = atomic.queryAtomic(root, "guardar veiculo garagem", { budget: 450 });
    assert.ok(answer.hits.length > 0);
    assert.ok(answer.hits.some((h) => h.node.content.includes("placa")));
    assert.ok(answer.hits.every((h) => !h.node.content.includes("multa de apreensão")));
    assert.ok(answer.tokensUsed <= 450);
    const result = tools.queryGraph(root, "guardar veiculo garagem", { rebuild: false, budget: 450 });
    assert.equal(result.mode, "atomic");
    assert.ok(result.memories.some((m) => m.content.includes("placa")));
    assert.ok(result.memories.every((m) => !m.content.includes("multa de apreensão")));
  });

  it("answers broad questions with a compact resource inventory", () => {
    atomic.buildAtomic(root);
    const answer = tools.queryGraph(root, "o que tinha dentro da garages?", { rebuild: false, budget: 350 });
    assert.equal(answer.mode, "atomic");
    assert.equal(answer.memories.length, 1);
    assert.equal(answer.memories[0].kind, "resource-overview");
    assert.match(answer.memories[0].content, /canStoreVehicle/);
    assert.match(answer.memories[0].content, /garages:store/);
    assert.ok(answer.tokensUsed <= 350);
  });

  it("incrementally updates only changed sources and removes stale nodes", () => {
    const first = atomic.buildAtomic(root);
    const second = atomic.buildAtomic(root);
    assert.equal(second.scanned, 0);
    assert.equal(second.reused, first.fileCount);
    fs.writeFileSync(path.join(root, source), body.replace("canStoreVehicle", "canParkVehicle"));
    const third = atomic.buildAtomic(root);
    assert.equal(third.scanned, 1);
    assert.ok(third.nodes.some((node) => node.name === "canParkVehicle"));
    assert.ok(!third.nodes.some((node) => node.name === "canStoreVehicle"));
    fs.unlinkSync(path.join(root, source));
    const fourth = atomic.buildAtomic(root);
    assert.ok(!fourth.nodes.some((node) => node.name === "canParkVehicle"));
    assert.ok(fs.existsSync(path.join(root, memory)));
  });

  it("respects global storage and keeps the repo note accessible", () => {
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fxglobal-"));
    try {
      const memdir = path.join(globalRoot, "memory");
      fs.mkdirSync(memdir, { recursive: true });
      fs.copyFileSync(path.join(root, memory), path.join(memdir, "garages.md"));
      fs.writeFileSync(path.join(root, ".fxmind", "store.json"), JSON.stringify({
        mode: "global", globalRoot, projectId: "example",
      }));
      const indexed = atomic.buildAtomic(root);
      assert.ok(indexed.nodes.some((n) => n.group === "memory-atom"));
      assert.ok(fs.existsSync(path.join(globalRoot, "graph", "atomic-index.json")));
      assert.equal(fs.existsSync(path.join(root, ".fxmind", "graph", "atomic-index.json")), false);
    } finally {
      fs.rmSync(globalRoot, { recursive: true, force: true });
    }
  });

  it("does not index obvious secret assignment values", () => {
    const nodes = atomic.sourceNodes(root, source, 'function protected()\n  api_key = "secret-value"\nend', "hash");
    assert.ok(nodes.every((node) => !node.content.includes("secret-value")));
  });

  it("detects newly added code files without reading unrelated topic Markdown", () => {
    atomic.buildAtomic(root);
    const pathToIndex = atomic.indexPath(root);
    const state = JSON.parse(fs.readFileSync(pathToIndex, "utf8"));
    state.generatedAt = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(pathToIndex, JSON.stringify(state));
    const more = "resources/[ecco]/garages/extra.lua";
    fs.writeFileSync(path.join(root, more), 'RegisterNetEvent("garages:impound")');
    const got = atomic.queryAtomic(root, "garages:impound");
    assert.ok(got.hits.some((hit) => hit.node.name === "garages:impound"));
  });

  it("CLI migration rebuilds the index and retains Markdown", () => {
    const { execFileSync } = require("node:child_process");
    const previous = fs.readFileSync(path.join(root, memory), "utf8");
    const command = path.resolve(__dirname, "..", "install.js");
    const result = JSON.parse(execFileSync(process.execPath, [
      command, "memory", "migrate", "--target", root,
    ], { encoding: "utf8", timeout: 30000 }));
    assert.equal(result.ok, true);
    assert.equal(result.legacyMemoriesPreserved, true);
    assert.equal(fs.readFileSync(path.join(root, memory), "utf8"), previous);
    assert.ok(fs.existsSync(atomic.indexPath(root)));
  });
});

describe("source-grounded manual learning", () => {
  const input = () => ({
    topic: "garages", kind: "behavior",
    text: "Before a vehicle is stored, the handler rejects a missing plate or user id.",
    path: source,
    evidence: "if not userId or not plate then return false end",
    symbols: ["canStoreVehicle"],
    events: ["garages:store"],
  });

  it("stores one linked microfact, deduplicates it, and preserves legacy notes", () => {
    const before = fs.readFileSync(path.join(root, memory), "utf8");
    const first = atomic.addFact(root, input());
    assert.equal(first.added, true);
    assert.equal(atomic.addFact(root, input()).added, false);
    const graph = atomic.buildAtomic(root);
    const atoms = graph.nodes.filter((node) => node.id === first.id);
    assert.equal(atoms.length, 1);
    assert.equal(atoms[0].line, 3);
    assert.ok(graph.links.some((edge) => edge.type === "references-symbol"));
    assert.equal(fs.readFileSync(path.join(root, memory), "utf8"), before);
  });

  it("refuses unsupported claims, source path escape, and secret evidence", () => {
    assert.throws(() => atomic.addFact(root, { ...input(), evidence: "made-up source" }), /Evidence does not occur/);
    assert.throws(() => atomic.addFact(root, { ...input(), path: "../outside.lua" }), /escapes project/);
    assert.throws(() => atomic.addFact(root, { ...input(), text: 'api_key = "super-secret"' }), /Sensitive fact/);
  });

  it("stops serving facts whose source file was modified", () => {
    const fact = atomic.addFact(root, input());
    assert.ok(atomic.buildAtomic(root).nodes.some((node) => node.id === fact.id));
    fs.writeFileSync(path.join(root, source), body + "\n-- source changed\n");
    assert.ok(!atomic.buildAtomic(root).nodes.some((node) => node.id === fact.id));
  });

  it("CLI learns without new MCP tool and returns a linked fact", () => {
    const { execFileSync } = require("node:child_process");
    const result = JSON.parse(execFileSync(process.execPath, [
      path.resolve(__dirname, "..", "install.js"), "memory", "add",
      "--target", root, "--topic", "garages",
      "--text", input().text, "--path", source,
      "--evidence", input().evidence,
    ], { encoding: "utf8", timeout: 30000 }));
    assert.equal(result.ok, true);
    assert.equal(result.fact.added, true);
    assert.ok(atomic.readAtomic(root).nodes.some((n) => n.id === result.fact.id));
  });
});
