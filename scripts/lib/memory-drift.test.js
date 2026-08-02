const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { driftForFile, driftForStagedFiles, isCodeFile } = require("./memory-drift");

function writeMemory(root, slug, paths) {
  const memoryDir = path.join(root, ".fxmind", "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  const body = [
    "---",
    `topic: ${slug}`,
    `paths: [${paths.map((p) => `"${p}"`).join(", ")}]`,
    "---",
    "",
    `# ${slug}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(memoryDir, `${slug}.md`), body, "utf8");
}

describe("memory drift", () => {
  it("marks missing referenced files as broken", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxdrift-"));
    writeMemory(dir, "nui", ["resources/demo/nui/dist/index-old.js"]);
    const result = driftForFile(dir, "resources/demo/nui/dist/index-old.js");
    assert.equal(result.fileExists, false);
    assert.equal(result.hits[0].verdict, "broken");
  });

  it("marks existing referenced files as stale-candidate", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxdrift-"));
    const rel = "resources/demo/client.lua";
    fs.mkdirSync(path.join(dir, "resources", "demo"), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "-- ok\n", "utf8");
    writeMemory(dir, "demo", [rel]);
    const result = driftForFile(dir, rel);
    assert.equal(result.fileExists, true);
    assert.equal(result.hits[0].verdict, "stale-candidate");
  });

  it("blocks when staged non-deleted file is missing on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxdrift-"));
    writeMemory(dir, "nui", ["resources/demo/nui/dist/index-old.js"]);
    const result = driftForStagedFiles(dir, ["resources/demo/nui/dist/index-old.js"]);
    assert.equal(result.block, true);
    assert.equal(result.broken.length, 1);
  });

  it("does not treat intentional deletions as staged drift when caller excludes them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxdrift-"));
    writeMemory(dir, "nui", ["resources/demo/nui/dist/index-old.js"]);
    // Mimics pre-commit --diff-filter=ACMR: deleted path omitted from staged list
    const staged = ["resources/demo/nui/dist/index-new.js"];
    fs.mkdirSync(path.join(dir, "resources", "demo", "nui", "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, staged[0]), "export {}\n", "utf8");
    writeMemory(dir, "nui2", [staged[0]]);
    const result = driftForStagedFiles(dir, staged);
    assert.equal(result.block, false);
    assert.equal(result.broken.length, 0);
  });

  it("skips agent/config paths", () => {
    assert.equal(isCodeFile(".fxmind/memory/x.md"), false);
    assert.equal(isCodeFile(".cursor/hooks/pre-commit.js"), false);
    assert.equal(isCodeFile("resources/demo/client.lua"), true);
  });
});
