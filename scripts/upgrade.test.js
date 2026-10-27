"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const upgrade = require("./upgrade");

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fxupgrade-"));
  fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, ".fxmind", "memory", "garages.md"),
    "# garages\nvehicle storage validates plates\n");
  fs.writeFileSync(path.join(root, ".fxmind", "packs.json"), '{"packs":["fivem"]}');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("one-command --update --global-store migration", () => {
  it("recognizes the single update invocation without opening an installer wizard", () => {
    const cli = require("./install/cli");
    const args = cli.parseArgs(["--update", "--global-store", "-y", "--no-self-update", "--target", root]);
    assert.equal(args.update, true);
    assert.equal(args.globalStore, true);
    assert.equal(args.target, root);
    assert.equal(args.noSelfUpdate, true);
  });

  it("backs up and verifies legacy memories without rewriting their content", () => {
    const before = fs.readFileSync(path.join(root, ".fxmind", "memory", "garages.md"), "utf8");
    const backup = path.join(root, "safe-backup");
    const report = upgrade.prepareGlobalMigration(root, { backup, activate: false });
    assert.equal(report.files, 2);
    assert.equal(fs.readFileSync(path.join(backup, "memory", "garages.md"), "utf8"), before);
    assert.equal(fs.readFileSync(path.join(root, ".fxmind", "memory", "garages.md"), "utf8"), before);
    assert.throws(() => upgrade.makeBackup(path.join(root, ".fxmind"), backup), /exists/);
  });

  it("copies existing linked memory into an independent verified backup", () => {
    const external = path.join(root, "global-memory");
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "legacy.md"), "source-linked memory");
    fs.rmSync(path.join(root, ".fxmind", "memory"), { recursive: true });
    fs.symlinkSync(external, path.join(root, ".fxmind", "memory"), process.platform === "win32" ? "junction" : "dir");
    const backup = path.join(root, "linked-backup");
    const count = upgrade.makeBackup(path.join(root, ".fxmind"), backup);
    assert.equal(count, 2);
    fs.writeFileSync(path.join(external, "legacy.md"), "changed after backup");
    assert.equal(fs.readFileSync(path.join(backup, "memory", "legacy.md"), "utf8"), "source-linked memory");
  });

  it("stops if backup content cannot be verified", () => {
    const source = path.join(root, ".fxmind");
    const backup = path.join(root, "other-backup");
    assert.equal(upgrade.makeBackup(source, backup), 2);
    fs.writeFileSync(path.join(backup, "memory", "garages.md"), "modified");
    assert.notEqual(fs.readFileSync(path.join(source, "memory", "garages.md"), "utf8"),
      fs.readFileSync(path.join(backup, "memory", "garages.md"), "utf8"));
  });

  it("updates selected client plugins and indexes the project once", () => {
    const installs = [], graphs = [];
    const report = upgrade.finishGlobalMigration(root, [
      { id: "cursor" }, { id: "cursor" }, { id: "claude" }, { id: "unknown" },
    ], {
      plugin(args) { installs.push(args[0]); return 0; },
      buildGraph(target, options) { graphs.push({ target, options }); return { atomicIndex: { nodes: 9 } }; },
    });
    assert.deepEqual(installs, ["cursor", "claude"]);
    assert.deepEqual(graphs, [{ target: root, options: { updateHtml: false } }]);
    assert.equal(report.atomicIndex.nodes, 9);
    assert.equal(report.legacyMemoriesPreserved, true);
  });

  it("fails safely on plugin failure rather than reporting success", () => {
    assert.throws(() => upgrade.finishGlobalMigration(root, [{ id: "cursor" }], {
      plugin() { return 1; },
      buildGraph() { throw new Error("must not build"); },
    }), /plugin installation failed/);
  });
});
