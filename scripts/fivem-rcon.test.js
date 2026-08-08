const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fivem = require("./fivem-rcon");

function writeInstallMarker(dir, password = "fxmind-local-dev") {
  fs.mkdirSync(path.join(dir, ".fxmind"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".fxmind", "rcon.json"),
    `${JSON.stringify({
      installedAt: new Date().toISOString(),
      execCfg: "dev/dev.cfg",
      password,
    })}\n`,
    "utf8",
  );
}

describe("fivem rcon allowlist", () => {
  it("allows ensure/stop/restart/refresh", () => {
    assert.equal(fivem.sanitizeCommand("ensure my_res").ok, true);
    assert.equal(fivem.sanitizeCommand("ensure my_res").command, "ensure my_res");
    assert.equal(fivem.sanitizeCommand("restart vrp").command, "restart vrp");
    assert.equal(fivem.sanitizeCommand("refresh").command, "refresh");
  });

  it("allows fxmind_nui_dump with optional resource", () => {
    assert.equal(fivem.sanitizeCommand("fxmind_nui_dump").ok, true);
    assert.equal(fivem.sanitizeCommand("fxmind_nui_dump").command, "fxmind_nui_dump");
    assert.equal(fivem.sanitizeCommand("fxmind_nui_dump my_nui").command, "fxmind_nui_dump my_nui");
    assert.equal(fivem.sanitizeCommand("fxmind_nui_dump bad name").ok, false);
  });

  it("rejects dangerous or invalid commands", () => {
    assert.equal(fivem.sanitizeCommand("quit").ok, false);
    assert.equal(fivem.sanitizeCommand("exec server.cfg").ok, false);
    assert.equal(fivem.sanitizeCommand("ensure").ok, false);
    assert.equal(fivem.sanitizeCommand("ensure bad name").ok, false);
    assert.equal(fivem.sanitizeCommand("ensure ../../x").ok, false);
  });

  it("tails rcon + server-debug logs when install marker exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlog-"));
    writeInstallMarker(dir);
    const fxmind = path.join(dir, ".fxmind");
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

  it("consoleTail fails without fxmind fivem install", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlog-"));
    const result = fivem.consoleTail({ root: dir, lines: 20 });
    assert.equal(result.ok, false);
    assert.match(result.error, /fivem install/i);
  });

  it("appendRconLog feeds consoleTail", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxlog-"));
    writeInstallMarker(dir);
    const log = path.join(dir, ".fxmind", "fivem-console.log");
    fivem.appendRconLog(
      { logPath: log },
      { ok: true, command: "ensure shops", response: "Started resource shops\n" },
    );
    const result = fivem.consoleTail({ root: dir, logPath: log, lines: 20 });
    assert.equal(result.ok, true);
    assert.match(result.content, /> ensure shops/);
    assert.match(result.content, /Started resource shops/);
  });

  it("installFivemDev is idempotent and writes rcon + vscode task + marker", () => {
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
    assert.equal(first.execCfg, "dev/dev.cfg");
    assert.match(fs.readFileSync(path.join(dir, "dev", "dev.cfg"), "utf8"), /rcon_password/);
    assert.ok(fivem.isFivemInstalled(dir));
    assert.ok(fs.existsSync(path.join(dir, ".fxmind", "rcon.json")));
    assert.ok(fs.existsSync(path.join(dir, ".vscode", "fivem-start.ps1")));
    const ps1 = fs.readFileSync(path.join(dir, ".vscode", "fivem-start.ps1"), "utf8");
    assert.doesNotMatch(ps1, /2>&1\s*\|\s*ForEach-Object/);
    assert.ok(fs.existsSync(path.join(dir, ".vscode", "tasks.json")));
    const cfg = fs.readFileSync(path.join(dir, "dev", "dev.cfg"), "utf8");
    assert.match(cfg, /ensure\s+fxmind-nui-bridge/);
    assert.match(cfg, /fxmind_nui_dump_path/);
    assert.ok(
      fs.existsSync(path.join(dir, "resources", "[local]", "fxmind-nui-bridge", "server.lua")) ||
        fs.existsSync(path.join(dir, "resources", "fxmind-nui-bridge", "server.lua")),
    );
    const second = fivem.installFivemDev({ root: dir });
    assert.equal(second.needsServerRestart, false);
    assert.equal(
      second.steps.find((s) => s.step === "rcon_password").action,
      "kept",
    );
  });

  it("installFivemDev with only server.cfg creates dev/dev.cfg and does not touch server.cfg", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxinst-"));
    const prodCfg = path.join(dir, "server.cfg");
    fs.writeFileSync(prodCfg, 'endpoint_add_udp "0.0.0.0:30120"\n# production\n', "utf8");
    const before = fs.readFileSync(prodCfg, "utf8");
    const result = fivem.installFivemDev({ root: dir });
    assert.equal(result.ok, true);
    assert.equal(result.execCfg, "dev/dev.cfg");
    assert.equal(fs.readFileSync(prodCfg, "utf8"), before);
    assert.match(fs.readFileSync(path.join(dir, "dev", "dev.cfg"), "utf8"), /rcon_password/);
  });

  it("upgrades legacy tee script that breaks interactive console", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxinst-"));
    fs.mkdirSync(path.join(dir, "dev"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".vscode"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dev", "dev.cfg"),
      'endpoint_add_udp "0.0.0.0:30120"\nset rcon_password "fxmind-local-dev"\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, ".vscode", "fivem-start.ps1"),
      "& $fx @argsList 2>&1 | ForEach-Object { Write-Host $_ }\n",
      "utf8",
    );
    const result = fivem.installFivemDev({ root: dir });
    const ps1 = fs.readFileSync(path.join(dir, ".vscode", "fivem-start.ps1"), "utf8");
    assert.equal(
      result.steps.find((s) => s.step === "ps1").action,
      "fixed-interactive-console",
    );
    assert.doesNotMatch(ps1, /2>&1\s*\|\s*ForEach-Object/);
  });

  it("statusProbe reports unavailable when install was not run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxprobe-"));
    const result = await fivem.statusProbe({ root: dir });
    assert.equal(result.installed, false);
    assert.equal(result.configured, false);
    assert.equal(result.available, false);
    assert.equal(result.serverReachable, false);
    assert.match(result.reason, /fivem install/i);
  });

  it("execRcon fails without install marker", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxexec-"));
    fs.mkdirSync(path.join(dir, "dev"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dev", "dev.cfg"),
      'set rcon_password "secret"\n',
      "utf8",
    );
    const result = await fivem.execRcon("status", { root: dir, password: "secret" });
    assert.equal(result.ok, false);
    assert.match(result.error, /fivem install/i);
  });

  it("execRcon does not succeed without UDP reply when install exists", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxexec-"));
    writeInstallMarker(dir);
    const result = await fivem.execRcon("status", {
      root: dir,
      password: "fxmind-local-dev",
      timeoutMs: 400,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /no reply|not running/i);
  });
});
