const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const selfUpdate = require("./self-update");

describe("self-update fallback", () => {
  it("treats a missing or unreadable global dir as unusable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxself-"));
    assert.equal(selfUpdate.isReadableDir(dir), true);
    assert.equal(selfUpdate.isReadableDir(path.join(dir, "missing")), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the fallback install under ~/.fxmind/npm", () => {
    const prefix = selfUpdate.fallbackPrefix();
    assert.equal(prefix, path.join(os.homedir(), ".fxmind", "npm"));
    assert.ok(selfUpdate.fallbackInstallScript().startsWith(prefix));
    assert.ok(selfUpdate.fallbackInstallScript().endsWith(path.join("fxmind", "scripts", "install.js")));
  });
});
