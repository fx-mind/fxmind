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

  it("installFivemDev is idempotent and writes rcon + vscode task", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxinst-"));
    fs.mkdirSync(path.join(dir, "dev"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dev", "dev.cfg"),
      'endpoint_add_udp "0.0.0.0:30120"\n',
      "utf8",
    );
    const first = fivem.installFivemDev({ root: dir });
    assert.equal(first.ok, true);
    assert.equal(first.passwordSet, true);
    assert.equal(first.needsServerRestart, true);
    assert.match(fs.readFileSync(path.join(dir, "dev", "dev.cfg"), "utf8"), /rcon_password/);
    assert.ok(fs.existsSync(path.join(dir, ".vscode", "fivem-start.ps1")));
    assert.ok(fs.existsSync(path.join(dir, ".vscode", "tasks.json")));
    const second = fivem.installFivemDev({ root: dir });
    assert.equal(second.needsServerRestart, false);
    assert.equal(
      second.steps.find((s) => s.step === "rcon_password").action,
      "kept",
    );
  });
});
