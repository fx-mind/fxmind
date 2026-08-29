const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panel = require("./panel-api");

describe("panel-api", () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxpanel-"));
    originalHome = process.env.USERPROFILE || process.env.HOME;
    if (process.platform === "win32") {
      process.env.USERPROFILE = tmpHome;
    } else {
      process.env.HOME = tmpHome;
    }
  });

  afterEach(() => {
    if (process.platform === "win32") {
      process.env.USERPROFILE = originalHome;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("getPortspaceSettings never returns raw integration key", () => {
    const configPath = path.join(tmpHome, ".fxmind", "panel.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        portspace: {
          baseUrl: "https://api.example.com",
          integrationKey: "secret-key-1234567890",
        },
      }),
      "utf8",
    );

    const settings = panel.getPortspaceSettings();
    assert.equal(settings.baseUrl, "https://api.example.com");
    assert.equal(settings.hasKey, true);
    assert.ok(!JSON.stringify(settings).includes("secret-key"));
    assert.equal(settings.keyPrefix, "secret-k…");
  });

  it("putPortspaceSettings preserves key when not sent", () => {
    panel.putPortspaceSettings({
      baseUrl: "https://a.test",
      integrationKey: "keep-me-abcdef",
    });
    const next = panel.putPortspaceSettings({ baseUrl: "https://b.test" });
    assert.equal(next.baseUrl, "https://b.test");
    assert.equal(next.hasKey, true);

    const raw = JSON.parse(fs.readFileSync(panel.panelConfigPath(), "utf8"));
    assert.equal(raw.portspace.integrationKey, "keep-me-abcdef");
  });

  it("fetchPortspaceInbox returns configured false without credentials", async () => {
    const inbox = await panel.fetchPortspaceInbox({ version: 1, portspace: null });
    assert.equal(inbox.configured, false);
    assert.deepEqual(inbox.items, []);
  });

  it("listProjects includes cwd when registry empty", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxproj-"));
    const { projects } = panel.listProjects(cwd);
    assert.ok(projects.some((p) => p.root.replace(/\\/g, "/") === cwd.replace(/\\/g, "/")));
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
