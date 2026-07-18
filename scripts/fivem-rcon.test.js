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

  it("tails rcon + server-debug logs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlog-"));
    const fxmind = path.join(dir, ".fxmind");
    fs.mkdirSync(fxmind);
    const debugLog = path.join(fxmind, "server-debug.log");
    const rconLog = path.join(fxmind, "fivem-console.log");
    fs.writeFileSync(debugLog, "[fxmind:shops] hello\n", "utf8");
    fivem.appendRconLog(
      { logPath: rconLog },
      { ok: true, command: "ensure shops", response: "Started resource shops\n" },
    );
    const result = fivem.consoleTail({ root: dir, logPath: rconLog, lines: 40 });
    assert.equal(result.ok, true);
    assert.match(result.content, /\[fxmind:shops\] hello/);
    assert.match(result.content, /> ensure shops/);
  });

  it("appendRconLog feeds consoleTail", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlog-"));
    const log = path.join(dir, "fivem-console.log");
    fivem.appendRconLog(
      { logPath: log },
      { ok: true, command: "ensure shops", response: "Started resource shops\n" },
    );
    const result = fivem.consoleTail({ root: dir, logPath: log, lines: 20 });
    assert.equal(result.ok, true);
    assert.match(result.content, /> ensure shops/);
    assert.match(result.content, /Started resource shops/);
  });
});
