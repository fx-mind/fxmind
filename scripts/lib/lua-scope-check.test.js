const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { analyzeLuaSource } = require("./lua-scope-check");

describe("lua lexical scope checker", () => {
  it("rejects caller defined before a later local function", () => {
    const result = analyzeLuaSource([
      "local function playerDropped()",
      "  syncDatatableNeeds()",
      "end",
      "",
      "local function syncDatatableNeeds()",
      "end",
    ].join("\n"), "base.lua");
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].rule, "late-local-function");
    assert.equal(result.issues[0].symbol, "syncDatatableNeeds");
  });

  it("accepts callee before caller", () => {
    const result = analyzeLuaSource([
      "local function syncDatatableNeeds()",
      "end",
      "",
      "local function playerDropped()",
      "  syncDatatableNeeds()",
      "end",
    ].join("\n"));
    assert.equal(result.ok, true);
  });

  it("rejects caller before a later local function assignment", () => {
    const result = analyzeLuaSource([
      "local function caller()",
      "  syncDatatableNeeds()",
      "end",
      "",
      "local syncDatatableNeeds = function()",
      "end",
    ].join("\n"));
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].rule, "late-local-function");
  });

  it("accepts explicit forward declaration plus later assignment", () => {
    const result = analyzeLuaSource([
      "local syncDatatableNeeds",
      "",
      "local function playerDropped()",
      "  syncDatatableNeeds()",
      "end",
      "",
      "syncDatatableNeeds = function()",
      "end",
    ].join("\n"));
    assert.equal(result.ok, true);
  });

  it("flags a helper declared in a visibly narrower scope", () => {
    const result = analyzeLuaSource([
      "if enabled then",
      "    local function syncDatatableNeeds()",
      "    end",
      "end",
      "syncDatatableNeeds()",
    ].join("\n"));
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].rule, "narrow-local-scope");
  });
});
