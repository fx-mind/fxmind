const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fivem = require("./fivem-rcon");

describe("fivem rcon allowlist", () => {
  it("allows ensure/stop/restart/refresh", () => {
    assert.equal(fivem.sanitizeCommand("ensure my_res").ok, true);
    assert.equal(fivem.sanitizeCommand("ensure my_res").command, "ensure my_res");
    assert.equal(fivem.sanitizeCommand("restart vrp").command, "restart vrp");
    assert.equal(fivem.sanitizeCommand("refresh").command, "refresh");
  });

  it("rejects dangerous or invalid commands", () => {
    assert.equal(fivem.sanitizeCommand("quit").ok, false);
    assert.equal(fivem.sanitizeCommand("exec server.cfg").ok, false);
    assert.equal(fivem.sanitizeCommand("ensure").ok, false);
    assert.equal(fivem.sanitizeCommand("ensure bad name").ok, false);
    assert.equal(fivem.sanitizeCommand("ensure ../../x").ok, false);
  });

  it("tails log file when present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlog-"));
    const log = path.join(dir, "fivem-console.log");
    fs.writeFileSync(log, "a\nb\nc\nd\ne\n", "utf8");
    const result = fivem.consoleTail({ logPath: log, lines: 3 });
    assert.equal(result.ok, true);
    assert.match(result.content, /d\ne/);
  });
});
