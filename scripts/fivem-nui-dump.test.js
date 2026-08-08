const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const nui = require("./fivem-nui-dump");

function writeInstallMarker(dir) {
  fs.mkdirSync(path.join(dir, ".fxmind"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".fxmind", "rcon.json"),
    `${JSON.stringify({
      installedAt: new Date().toISOString(),
      execCfg: "dev/dev.cfg",
      password: "fxmind-local-dev",
    })}\n`,
    "utf8",
  );
}

function scaffoldNuiResource(dir, name = "demo_nui") {
  const res = path.join(dir, "resources", "[local]", name);
  const web = path.join(res, "web");
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(
    path.join(res, "fxmanifest.lua"),
    `fx_version 'cerulean'\ngame 'gta5'\nui_page 'web/index.html'\nfiles { 'web/index.html' }\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(web, "index.html"),
    `<!doctype html><html><body><h1>Demo</h1></body></html>\n`,
    "utf8",
  );
  fs.mkdirSync(path.join(dir, "dev"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dev", "dev.cfg"), 'endpoint_add_udp "0.0.0.0:30120"\n', "utf8");
  return res;
}

describe("fivem nui dump", () => {
  it("readNuiDump returns structured dump from .fxmind/nui-dump.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxnui-"));
    writeInstallMarker(dir);
    const payload = {
      ok: true,
      resource: "police",
      state: { view: "history", records: 1 },
    };
    fs.writeFileSync(
      path.join(dir, ".fxmind", "nui-dump.json"),
      `${JSON.stringify(payload)}\n`,
      "utf8",
    );
    const result = nui.readNuiDump({ root: dir });
    assert.equal(result.ok, true);
    assert.equal(result.dump.resource, "police");
    assert.equal(result.dump.state.records, 1);
  });

  it("readNuiDump fails clearly when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxnui-"));
    writeInstallMarker(dir);
    const result = nui.readNuiDump({ root: dir });
    assert.equal(result.ok, false);
    assert.match(result.error, /no NUI dump/i);
  });

  it("nuiDump trigger:false reads without RCON", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxnui-"));
    writeInstallMarker(dir);
    fs.writeFileSync(
      path.join(dir, ".fxmind", "nui-dump.json"),
      JSON.stringify({ ok: true, state: { tab: "radio" } }),
      "utf8",
    );
    const result = await nui.nuiDump({ root: dir, trigger: false });
    assert.equal(result.ok, true);
    assert.equal(result.dump.state.tab, "radio");
  });

  it("nuiDump requires fivem install marker", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxnui-"));
    const result = await nui.nuiDump({ root: dir, trigger: false });
    assert.equal(result.ok, false);
    assert.match(result.error, /fivem install/i);
  });

  it("wireNuiDump patches manifest + html and unwire removes them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxnui-"));
    writeInstallMarker(dir);
    const res = scaffoldNuiResource(dir, "demo_nui");

    const wired = nui.wireNuiDump({ root: dir, resource: "demo_nui" });
    assert.equal(wired.ok, true, wired.error);
    assert.equal(wired.resource, "demo_nui");

    const manifest = fs.readFileSync(path.join(res, "fxmanifest.lua"), "utf8");
    assert.match(manifest, /FXMIND-NUI-DUMP-START/);
    assert.match(manifest, /@fxmind-nui-bridge\/client-hook\.lua/);

    const html = fs.readFileSync(path.join(res, "web", "index.html"), "utf8");
    assert.match(html, /FXMIND-NUI-DUMP-START/);
    assert.match(html, /fxmind-nui-probe\.js/);
    assert.ok(fs.existsSync(path.join(res, "web", "fxmind-nui-probe.js")));
    assert.ok(fs.existsSync(path.join(dir, ".fxmind", "nui-wire.json")));

    fs.writeFileSync(
      path.join(dir, ".fxmind", "nui-dump.json"),
      JSON.stringify({ ok: true, state: { x: 1 } }),
      "utf8",
    );

    const again = nui.wireNuiDump({ root: dir, resource: "demo_nui" });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyWired, true);

    const unwired = nui.unwireNuiDump({ root: dir });
    assert.equal(unwired.ok, true);
    const manifestAfter = fs.readFileSync(path.join(res, "fxmanifest.lua"), "utf8");
    assert.doesNotMatch(manifestAfter, /FXMIND-NUI-DUMP/);
    assert.doesNotMatch(manifestAfter, /fxmind-nui-bridge/);
    const htmlAfter = fs.readFileSync(path.join(res, "web", "index.html"), "utf8");
    assert.doesNotMatch(htmlAfter, /FXMIND-NUI-DUMP/);
    assert.equal(fs.existsSync(path.join(res, "web", "fxmind-nui-probe.js")), false);
    assert.equal(fs.existsSync(path.join(dir, ".fxmind", "nui-wire.json")), false);
    assert.equal(fs.existsSync(path.join(dir, ".fxmind", "nui-dump.json")), false);
  });

  it("parseUiPage reads quoted ui_page", () => {
    assert.equal(nui.parseUiPage(`ui_page 'web/index.html'\n`), "web/index.html");
    assert.equal(nui.parseUiPage(`ui_page "nui/dist/index.html"\n`), "nui/dist/index.html");
  });
});
