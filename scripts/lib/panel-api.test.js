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
    fs.mkdirSync(path.join(cwd, ".fxmind"));
    const { projects, workspaceId } = panel.listProjects(cwd);
    const local = projects.find((p) => p.local);
    assert.ok(local);
    assert.equal(local.hasFxmind, true);
    assert.equal(local.root.replace(/\\/g, "/"), cwd.replace(/\\/g, "/"));
    assert.equal(local.source, "local");
    assert.equal(workspaceId, local.id);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("reports an uninstalled repository and selects it by its exact root", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fx-uninstalled-"));
    const listed = panel.listProjects(cwd, { exact: true });
    const local = listed.projects.find((p) => p.local);
    assert.ok(local);
    assert.equal(local.hasFxmind, false);

    const selected = panel.selectProjectRoot(local.id, cwd, { exact: true });
    assert.equal(selected.ok, true);
    assert.equal(selected.root.replace(/\\/g, "/"), cwd.replace(/\\/g, "/"));
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("detects and serves a png from the selected repository root", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fx-project-icon-"));
    try {
      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
      fs.writeFileSync(path.join(cwd, "logo.png"), png);
      fs.writeFileSync(path.join(cwd, "other.png"), png);

      const listed = panel.listProjects(cwd, { exact: true });
      const local = listed.projects.find((p) => p.local);
      assert.ok(local);
      assert.equal(local.hasRootPng, true);

      const result = panel.getProjectIcon(local.id, cwd, { exact: true });
      assert.equal(result.ok, true);
      assert.equal(result.contentType, "image/png");
      assert.deepEqual(result.data, png);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("walks up to the folder that contains .fxmind", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxroot-"));
    fs.mkdirSync(path.join(root, ".fxmind"));
    const nested = path.join(root, "src", "client");
    fs.mkdirSync(nested, { recursive: true });
    const found = panel.findProjectRoot(nested);
    assert.equal(found.replace(/\\/g, "/"), root.replace(/\\/g, "/"));
    const { workspaceRoot, projects } = panel.listProjects(nested);
    assert.equal(workspaceRoot.replace(/\\/g, "/"), root.replace(/\\/g, "/"));
    assert.equal(projects[0].local, true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("pushRecentRoot stores up to 8 unique roots", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "fxrecent-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "fxrecent-b-"));
    panel.pushRecentRoot(a);
    panel.pushRecentRoot(b);
    panel.pushRecentRoot(a);
    const recents = panel.getRecentRoots();
    assert.equal(recents[0].replace(/\\/g, "/"), a.replace(/\\/g, "/"));
    assert.equal(recents[1].replace(/\\/g, "/"), b.replace(/\\/g, "/"));
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });

  it("getWorkspaceInfo reports memory count and hasFxmind", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxws-"));
    fs.mkdirSync(path.join(cwd, ".fxmind", "memory"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".fxmind", "memory", "test.md"), "# t\n", "utf8");
    const info = panel.getWorkspaceInfo(cwd);
    assert.equal(info.hasFxmind, true);
    assert.ok(info.memoryCount >= 0);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("reads the project graph from the fixed local graph path", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-"));
    try {
      fs.mkdirSync(path.join(cwd, ".fxmind", "graph"), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, ".fxmind", "graph", "knowledge-graph.json"),
        JSON.stringify({
          nodes: [{ id: "n1" }],
          links: [{ source: "n1", target: "n2" }],
          meta: { version: 1 },
        }),
        "utf8",
      );
      const projectId = panel.listProjects(cwd).workspaceId;
      const result = panel.getProjectGraph(projectId, cwd);
      assert.equal(result.ok, true);
      assert.deepEqual(result.nodes, [{ id: "n1" }]);
      assert.equal(result.links.length, 1);
      assert.deepEqual(result.meta, { version: 1 });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns only confirmed graph links", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-filter-"));
    try {
      fs.mkdirSync(path.join(cwd, ".fxmind", "graph"), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, ".fxmind", "graph", "knowledge-graph.json"),
        JSON.stringify({
          nodes: [
            { id: "admin", resources: "[scripts]" },
            { id: "hud", resources: "[scripts], hud" },
            { id: "voice", resources: "hud" },
            { id: "inferred" },
          ],
          links: [
            { source: "admin", target: "hud", type: "shared-resource", confidence: "extracted" },
            { source: "voice", target: "hud", type: "shared-resource", confidence: "extracted" },
            { source: "voice", target: "inferred", type: "domain-related", confidence: "inferred" },
          ],
        }),
        "utf8",
      );
      const projectId = panel.listProjects(cwd).workspaceId;
      const result = panel.getProjectGraph(projectId, cwd);
      assert.equal(result.ok, true);
      assert.deepEqual(result.links, [
        { source: "voice", target: "hud", type: "shared-resource", confidence: "extracted" },
      ]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps verified event-domain links", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxgraph-event-domain-"));
    try {
      fs.mkdirSync(path.join(cwd, ".fxmind", "graph"), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, ".fxmind", "graph", "knowledge-graph.json"),
        JSON.stringify({
          nodes: [
            { id: "cacheaside", events: "garages:user_vehicles" },
            { id: "garage", events: "garages:OpenGarage" },
            { id: "unrelated", events: "player:connected" },
          ],
          links: [
            {
              source: "cacheaside",
              target: "garage",
              type: "event-domain",
              confidence: "inferred",
            },
            {
              source: "cacheaside",
              target: "unrelated",
              type: "event-domain",
              confidence: "inferred",
            },
          ],
        }),
        "utf8",
      );
      const projectId = panel.listProjects(cwd).workspaceId;
      const result = panel.getProjectGraph(projectId, cwd);
      assert.deepEqual(result.links, [
        {
          source: "cacheaside",
          target: "garage",
          type: "event-domain",
          confidence: "inferred",
        },
      ]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("bindWorkspaceRoot pushes to recent roots", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fxbind-"));
    fs.mkdirSync(path.join(cwd, ".fxmind"));
    const bound = panel.bindWorkspaceRoot(cwd);
    assert.equal(bound.replace(/\\/g, "/"), cwd.replace(/\\/g, "/"));
    const recents = panel.getRecentRoots();
    assert.ok(recents.some((r) => r.replace(/\\/g, "/") === cwd.replace(/\\/g, "/")));
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
