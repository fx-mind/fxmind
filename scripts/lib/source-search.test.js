const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { searchSource } = require("./source-search");

describe("bounded source search", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxsearch-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "one.js"), "const label = 'Save';\nsave();\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it("finds literal symbols without a memory graph or Git", () => {
    const result = searchSource(root, { directory: "src", query: "SAVE" });
    assert.deepEqual(result.matches.map(({ file, line }) => ({ file, line })), [
      { file: "src/one.js", line: 1 }, { file: "src/one.js", line: 2 },
    ]);
    assert.equal(searchSource(root, { query: ".*" }).matches.length, 0);
  });
  it("bounds output and reports incomplete coverage", () => {
    const result = searchSource(root, { directory: "src", query: "save", limit: 1 });
    assert.equal(result.matches.length, 1);
    assert.equal(result.truncated, true);
  });
  it("excludes generated and binary files", () => {
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules", "dep.js"), "save");
    fs.writeFileSync(path.join(root, "image.bin"), "save\0save");
    assert.equal(searchSource(root, { query: "save" }).matches.length, 2);
  });
  it("respects Git ignores and directory scope", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, ".gitignore"), "ignored.js\n");
    fs.writeFileSync(path.join(root, "src", "ignored.js"), "save");
    fs.writeFileSync(path.join(root, "outside.js"), "save");
    const result = searchSource(root, { directory: "src", query: "save" });
    assert.equal(result.matches.length, 2);
    assert.ok(result.matches.every((match) => match.file === "src/one.js"));
  });
  it("rejects escaping directories and invalid queries", () => {
    assert.throws(() => searchSource(root, { directory: "..", query: "save" }), /inside the project/);
    assert.throws(() => searchSource(root, { query: "" }), /non-empty/);
  });
});
