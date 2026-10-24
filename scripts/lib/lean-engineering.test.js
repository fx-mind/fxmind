"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const lean = require("./lean-engineering");
const prompt = require("../prompt-context");
const review = require("./independent-review");

describe("Lean Planner and source reuse", () => {
  let root;
  const put = (name, value) => {
    const dest = path.join(root, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-lean-"));
    fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
    put("resources/inventory/server.lua", [
      "local function keepWeight(playerId) return playerId end",
      "RegisterNetEvent('inventory:setCapacity')",
      "AddEventHandler('inventory:setCapacity', function() end)",
      "exports('GetCapacity', function() return 10 end)",
      "lib.callback.register('inventory:getWeight', function() end)",
    ].join("\n"));
    put("src/garage/helpers.js", "export function garageState() {}\nexport const garageConfig = {};\n");
    put("node_modules/inventory/secret.js", "export function shouldNeverBeIndexed() {}\n");
    put(".fxmind/memory/other.md", "# no match\n");
    execFileSync("git", ["add", "resources/inventory/server.lua", "src/garage/helpers.js"], {
      cwd: root, windowsHide: true,
    });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("advises reuse and does not invent a new gate", () => {
    const text = lean.leanPlan("fix");
    assert.match(text, /existing code/i);
    assert.match(text, /smallest COMPLETE/i);
    assert.match(text, /Gate B/);
    assert.equal(lean.leanPlan(null), "");
  });
  it("indexes Lua event handlers, exports and callbacks without reading generated code", () => {
    const text = lean.codebaseMap(root, "corrigir inventario inventory peso", { maxChars: 800 });
    assert.match(text, /resources\/inventory\/server\.lua/);
    assert.match(text, /keepWeight/);
    assert.match(text, /inventory:setCapacity/);
    assert.match(text, /GetCapacity/);
    assert.doesNotMatch(text, /shouldNeverBeIndexed/);
  });
  it("finds existing JavaScript helpers when path matches the requested feature", () => {
    const text = lean.codebaseMap(root, "corrigir garage garagem", { maxChars: 400 });
    assert.match(text, /src\/garage\/helpers.js/);
    assert.match(text, /garageState/);
  });
  it("caps map length, ignores irrelevant files and can be disabled", () => {
    assert.equal(lean.codebaseMap(root, "completamente outro tema"), "");
    assert.equal(lean.codebaseMap(root, "inventory", { enabled: false }), "");
    const result = lean.codebaseMap(root, "inventory", { maxChars: 200 });
    assert.ok(result.length < 360, "header plus bounded names");
  });
  it("never follows tracked symlinks into external files", { skip: process.platform === "win32" }, () => {
    const external = path.join(os.tmpdir(), "fxmind-external-" + process.pid);
    try {
      fs.writeFileSync(external, "export function forbidden() {}\n");
      fs.symlinkSync(external, path.join(root, "src", "garage", "external.js"));
      execFileSync("git", ["add", "src/garage/external.js"], { cwd: root });
      assert.doesNotMatch(lean.codebaseMap(root, "garage external"), /forbidden/);
    } finally { fs.rmSync(external, { force: true }); }
  });
  it("preloads guidance for technical tasks, but not for general explanations", () => {
    const technical = prompt.buildPromptContext(root, "corrigir inventario inventory", {
      queryResult: { ok: true, memories: [] }, plan: {
        kind: "fix", playbook: null, profile: null, stale: null, confidence: "high", source: "heuristic",
      }
    });
    assert.match(technical, /FXMIND Lean plan/);
    assert.match(technical, /resources\/inventory\/server\.lua/);
    const general = prompt.buildPromptContext(root, "explique o que e um monad", { queryResult: { ok: true, memories: [] } });
    assert.equal(general, "");
  });
  it("adds lean review to existing Gate V without a new gate", () => {
    const text = review.buildPrompt(root, { kind: "fix", note: "fix inventory" }, ["resources/inventory/server.lua"]);
    assert.match(text, /Lean review/);
    assert.match(text, /focused regression test/);
    assert.match(text, /Do NOT demand fewer lines/);
    assert.match(text, /VERDICT: VERIFIED/);
  });
});
