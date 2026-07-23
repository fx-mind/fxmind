const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tools = require("./fxmind-tools");

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-pro-"));
  fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
  return root;
}

describe("memory validation", () => {
  it("rejects missing frontmatter and empty routing fields", () => {
    const root = makeProject();
    const bad = path.join(root, ".fxmind", "memory", "broken.md");
    fs.writeFileSync(bad, "# no frontmatter\n", "utf8");
    const r = tools.validateMemory(root, { filePath: bad, slug: "broken" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /frontmatter/i.test(e)));
  });

  it("accepts valid memory with paths and triggers", () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "server.lua"), "-- ok\n", "utf8");
    const file = path.join(root, ".fxmind", "memory", "garagem.md");
    fs.writeFileSync(
      file,
      `---
topic: garagem
updated: 2026-07-17
framework: vrp
lang: en-compact
confidence: extracted
paths: [server.lua]
triggers: [garagem, garage]
---

# garagem

Files:
- handler: \`server.lua\`
`,
      "utf8",
    );
    const r = tools.validateMemory(root, { filePath: file, slug: "garagem" });
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });
});

describe("gates MCP-style API", () => {
  it("startTask + recordGate A/B/V/C manages taskActive", () => {
    const root = makeProject();
    const start = tools.startTask(root, { note: "test" });
    assert.equal(start.taskActive, true);
    assert.equal(start.schemaVersion, 1);

    tools.recordGate(root, "A", true, { note: "analysis" });
    tools.recordGate(root, "B", true, { note: "memories" });
    tools.recordGate(root, "V", true, { note: "verified" });
    let st = tools.gateStatus(root);
    assert.equal(st.taskActive, true);
    assert.equal(st.gates.A.complete, true);
    assert.equal(st.gates.B.complete, true);
    assert.equal(st.gates.V.complete, true);

    tools.recordGate(root, "C", true);
    st = tools.gateStatus(root);
    assert.equal(st.taskActive, false);
    assert.equal(st.gates.C.complete, true);
  });

  it("startTask trivial auto-completes A/B; C requires V", () => {
    const root = makeProject();
    const start = tools.startTask(root, { note: "tiny", trivial: true });
    assert.equal(start.trivial, true);
    assert.equal(start.gates.A.complete, true);
    assert.equal(start.gates.B.complete, true);

    assert.throws(() => tools.recordGate(root, "C", true), /Gate C requires Gate V/);

    tools.recordGate(root, "V", true, { note: "checked" });
    const done = tools.recordGate(root, "C", true);
    assert.equal(done.taskActive, false);
    assert.equal(done.gates.C.complete, true);
  });

  it("recordGate rejects unknown letters", () => {
    const root = makeProject();
    tools.startTask(root);
    assert.throws(() => tools.recordGate(root, "Z", true), /Invalid gate/);
  });

  it("recordGate START is alias for startTask", () => {
    const root = makeProject();
    const data = tools.recordGate(root, "START", true, { note: "go" });
    assert.equal(data.taskActive, true);
  });
});

describe("memory-index + gitignore", () => {
  it("writeMemoryIndex creates schemaVersion index", () => {
    const root = makeProject();
    const file = path.join(root, ".fxmind", "memory", "item.md");
    fs.writeFileSync(
      file,
      `---
topic: item
updated: 2026-07-17
lang: en-compact
paths: []
triggers: [item]
---

# item
`,
      "utf8",
    );
    const out = tools.writeMemoryIndex(root);
    assert.ok(out.path.endsWith("memory-index.json"));
    const index = tools.loadMemoryIndex(root);
    assert.equal(index.schemaVersion, 1);
    assert.equal(index.count, 1);
    assert.equal(index.memories[0].slug, "item");
  });

  it("ensureProjectGitignore adds session ignores", () => {
    const root = makeProject();
    const result = tools.ensureProjectGitignore(root);
    assert.ok(result.added.includes(".fxmind/fxmind-gates.json"));
    const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    assert.match(gi, /\.fxmind\/fxmind-gates\.json/);
    assert.match(gi, /\.fxmind\/metrics\.jsonl/);
    const again = tools.ensureProjectGitignore(root);
    assert.equal(again.added.length, 0);
  });

  it("findMemoryDuplicates detects shared triggers", () => {
    const root = makeProject();
    for (const [slug, trigger] of [
      ["a", "craft"],
      ["b", "craft"],
    ]) {
      fs.writeFileSync(
        path.join(root, ".fxmind", "memory", `${slug}.md`),
        `---
topic: ${slug}
updated: 2026-07-17
lang: en-compact
triggers: [${trigger}]
paths: []
---
`,
        "utf8",
      );
    }
    const dupes = tools.findMemoryDuplicates(root);
    assert.ok(dupes.some((d) => d.type === "trigger" && d.value === "craft"));
  });
});

describe("corrections backlog", () => {
  it("records, lists, exports, and promotes corrections", () => {
    const root = makeProject();
    const created = tools.recordCorrection(root, {
      title: "Fake LoadResourceFile import",
      category: "architecture",
      bad: "LoadResourceFile + load()",
      good: "Global ResgateDatabase in same server_scripts",
      rule: "Never fake-require sibling scripts in the same resource",
      commit: "ecd9eaec",
    });
    assert.equal(created.ok, true);
    assert.ok(created.id);

    const listed = tools.listCorrections(root, { status: "open" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].category, "architecture");

    const exported = tools.exportCorrections(root, { status: "open", format: "md" });
    assert.match(exported.markdown, /Fake LoadResourceFile/);

    const promoted = tools.promoteCorrection(root, created.id);
    assert.equal(promoted.status, "promoted");
    assert.equal(tools.listCorrections(root, { status: "open" }).length, 0);
    assert.equal(tools.listCorrections(root, { status: "promoted" }).length, 1);
  });
});
