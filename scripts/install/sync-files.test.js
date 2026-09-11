const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  copyFileIfChanged,
  writeFileIfChanged,
  writeJsonIfChanged,
  copyDirIfChanged,
  filesEqual,
} = require("./sync-files");
const { writePacksManifest, readPacksManifestFile } = require("./shared");
const { getPackageVersion } = require("./cli");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-sync-"));
}

describe("sync-files", () => {
  it("skips rewrite when file bytes already match", () => {
    const dir = tmpDir();
    const src = path.join(dir, "src.txt");
    const dest = path.join(dir, "dest.txt");
    fs.writeFileSync(src, "same\n", "utf8");
    fs.writeFileSync(dest, "same\n", "utf8");
    const before = fs.statSync(dest).mtimeMs;
    const result = copyFileIfChanged(src, dest);
    assert.equal(result.changed, false);
    assert.equal(fs.statSync(dest).mtimeMs, before);
    assert.equal(filesEqual(src, dest), true);
  });

  it("writes only when content differs", () => {
    const dir = tmpDir();
    const dest = path.join(dir, "out.txt");
    fs.writeFileSync(dest, "old\n", "utf8");
    assert.equal(writeFileIfChanged(dest, "old\n").changed, false);
    assert.equal(writeFileIfChanged(dest, "new\n").changed, true);
    assert.equal(fs.readFileSync(dest, "utf8"), "new\n");
  });

  it("skips JSON rewrite when objects are semantically equal", () => {
    const dir = tmpDir();
    const dest = path.join(dir, "data.json");
    fs.writeFileSync(dest, "{\n  \"b\": 2,\n  \"a\": 1\n}\n", "utf8");
    const before = fs.statSync(dest).mtimeMs;
    const result = writeJsonIfChanged(dest, { a: 1, b: 2 });
    assert.equal(result.changed, false);
    assert.equal(fs.statSync(dest).mtimeMs, before);
  });

  it("copies only changed files inside a directory", () => {
    const dir = tmpDir();
    const src = path.join(dir, "src");
    const dest = path.join(dir, "dest");
    fs.mkdirSync(path.join(src, "nested"), { recursive: true });
    fs.writeFileSync(path.join(src, "keep.md"), "keep\n", "utf8");
    fs.writeFileSync(path.join(src, "nested", "changed.md"), "v2\n", "utf8");
    fs.mkdirSync(path.join(dest, "nested"), { recursive: true });
    fs.writeFileSync(path.join(dest, "keep.md"), "keep\n", "utf8");
    fs.writeFileSync(path.join(dest, "nested", "changed.md"), "v1\n", "utf8");

    const result = copyDirIfChanged(src, dest);
    assert.equal(result.changed, true);
    assert.deepEqual(result.files, ["nested/changed.md"]);
    assert.equal(fs.readFileSync(path.join(dest, "nested", "changed.md"), "utf8"), "v2\n");
  });
});

describe("packs.json cliVersion", () => {
  it("stamps CLI version and skips rewrite when already current", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".fxmind"), { recursive: true });
    const first = writePacksManifest(dir, [], { agents: ["cursor"], command: true });
    assert.equal(first.changed, true);
    assert.equal(first.cliVersion, getPackageVersion());
    const manifest = readPacksManifestFile(dir);
    assert.equal(manifest.cliVersion, getPackageVersion());
    const updatedAt = manifest.updatedAt;
    const second = writePacksManifest(dir, [], { agents: ["cursor"], command: true });
    assert.equal(second.changed, false);
    assert.equal(readPacksManifestFile(dir).updatedAt, updatedAt);
  });
});
