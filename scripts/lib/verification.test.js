const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { startTask, recordGate, gateStatus, claimPaths } = require("../fxmind-tools");
const independentReview = require("./independent-review");

describe("verification gates", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxverify-"));
    fs.writeFileSync(path.join(root, "server.js"), "module.exports = 1;\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  function evidence(files = ["server.js"]) {
    return { files, review: "Checked callers and preserved boundary validation.", checks: [
      { kind: "test", target: "node --test server.test.js", expected: "reject invalid input", observed: "rejection assertion passed", status: "passed" },
    ] };
  }
  function start(options = {}) {
    const session = startTask(root, { trivial: true, ...options });
    if (options.ui) {
      recordGate(root, "A", true, { sessionId: session.sessionId });
      recordGate(root, "B", true, { sessionId: session.sessionId });
    }
    return session.sessionId;
  }
  function record(sessionId, data) { return recordGate(root, "V", true, { sessionId, evidence: data }); }
  function commitFixture() {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "fixture"], { cwd: root });
  }

  it("does not require opening an unchanged UI file included as verification context", () => {
    fs.writeFileSync(path.join(root, "App.tsx"), "export const App = () => <button>Save</button>;");
    commitFixture();
    const sessionId = start();
    fs.writeFileSync(path.join(root, "server.js"), "module.exports = 2;\n");
    assert.equal(record(sessionId, evidence(["server.js", "App.tsx"])).gates.V.complete, true);
  });

  it("accepts a justified non-visual UI refactor with lint and typecheck instead of a browser", () => {
    fs.writeFileSync(path.join(root, "App.tsx"), "export const App = () => <button>Save</button>;");
    commitFixture();
    const sessionId = start();
    fs.appendFileSync(path.join(root, "App.tsx"), "\n// Clarify the existing component without changing rendering.\n");
    const data = evidence(["App.tsx"]);
    data.ui = { changed: false, reason: "Only a comment changed; markup, styles and interactions are identical." };
    data.checks = [
      { kind: "lint", target: "npm run lint -- App.tsx", expected: "no lint errors", observed: "exit 0, no findings", status: "passed" },
      { kind: "typecheck", target: "npm run typecheck", expected: "no type errors", observed: "exit 0", status: "passed" },
    ];
    const result = record(sessionId, data);
    assert.equal(result.gates.V.complete, true);
    assert.equal(result.gates.V.evidence.scope, "code");
  });

  it("allows correcting a stale UI planning flag when the final change does not affect the interface", () => {
    const sessionId = start({ ui: true });
    const data = evidence();
    data.ui = { changed: false, reason: "Only server logging changed; UI output and behavior are preserved." };
    assert.equal(record(sessionId, data).gates.V.complete, true);
  });

  it("does not require legacy UI metadata and never passes failed lint", () => {
    const sessionId = start();
    const data = evidence();
    data.ui = { changed: false, reason: " " };
    assert.equal(record(sessionId, data).gates.V.complete, true);
    data.checks[0].kind = "lint";
    data.checks[0].status = "failed";
    assert.equal(record(sessionId, data).gates.V.complete, false);
  });

  it("verifies code without browser evidence even for backend-driven UI changes", () => {
    const data = evidence();
    data.ui = { changed: true, reason: "Server response changes the displayed validation error." };
    assert.equal(record(start(), data).gates.V.complete, true);
  });

  it("detects staged changes and deleted UI source when no assessment was supplied", () => {
    fs.writeFileSync(path.join(root, "App.tsx"), "export const App = () => <button>Save</button>;");
    commitFixture();
    const sessionId = start();
    fs.writeFileSync(path.join(root, "App.tsx"), "export const App = () => <button>Delete</button>;");
    execFileSync("git", ["add", "App.tsx"], { cwd: root });
    assert.equal(record(sessionId, evidence(["App.tsx"])).gates.V.complete, true);
    fs.rmSync(path.join(root, "App.tsx"));
    assert.equal(record(sessionId, evidence(["App.tsx"])).gates.V.complete, true);
  });

  it("rejects a note-only V and C before verification", () => {
    const sessionId = start();
    assert.throws(() => record(sessionId), /requires evidence/);
    assert.throws(() => recordGate(root, "C", true, { sessionId }), /requires Gate V/);
  });
  it("enforces order and invalidates verification after replanning", () => {
    const sessionId = startTask(root).sessionId;
    assert.throws(() => recordGate(root, "B", true, { sessionId }), /requires Gate A/);
    assert.throws(() => record(sessionId, evidence()), /requires Gate B/);
    recordGate(root, "A", true, { sessionId });
    recordGate(root, "B", true, { sessionId });
    record(sessionId, evidence());
    recordGate(root, "A", true, { sessionId, note: "Scope changed" });
    assert.equal(gateStatus(root, { sessionId }).gates.V, undefined);
  });
  it("persists failed/blocked checks without completing V", () => {
    for (const status of ["failed", "blocked"]) {
      const sessionId = start();
      const data = evidence();
      data.checks[0].status = status;
      assert.equal(record(sessionId, data).gates.V.complete, false);
      assert.throws(() => recordGate(root, "C", true, { sessionId }), /requires Gate V/);
    }
  });
  it("closes only after passing checks against unchanged code", () => {
    const sessionId = start();
    record(sessionId, evidence());
    assert.equal(recordGate(root, "C", true, { sessionId }).taskActive, false);
  });
  it("rejects edits after V, then accepts fresh verification", () => {
    const sessionId = start();
    record(sessionId, evidence());
    fs.writeFileSync(path.join(root, "server.js"), "module.exports = 2;\n");
    assert.throws(() => recordGate(root, "C", true, { sessionId }), /Code changed/);
    record(sessionId, evidence());
    assert.equal(recordGate(root, "C", true, { sessionId }).taskActive, false);
  });
  it("accepts frontend code checks without browser proof", () => {
    fs.writeFileSync(path.join(root, "App.tsx"), "export const App = () => <button>Save</button>;");
    const data = evidence(["App.tsx"]);
    data.browser = { required: true };
    data.checks[0].kind = "build";
    assert.equal(record(start(), data).gates.V.complete, true);
  });

  it("does not let unavailable browser or gameplay block code checks", () => {
    const sessionId = start({ ui: true });
    const data = evidence();
    data.browser = { status: "blocked", reason: "Preview requires an unavailable login" };
    data.checks.push({ kind: "runtime", target: "in-game test", expected: "observe zone edge", observed: "game server unavailable", status: "blocked" });
    const result = record(sessionId, data);
    assert.equal(result.gates.V.complete, true);
    assert.equal(result.gates.V.evidence.checks.length, 1);
    assert.equal(result.gates.V.evidence.runtimeChecks[0].status, "blocked");
    assert.equal(recordGate(root, "C", true, { sessionId }).taskActive, false);
  });

  it("never reads browser artifacts during code verification", () => {
    const sessionId = start({ ui: true });
    const data = evidence();
    data.browser = { status: "passed", artifact: "missing-trace.json" };
    assert.equal(record(sessionId, data).gates.V.complete, true);
  });
  it("cannot replace code verification with runtime observations", () => {
    const data = evidence();
    data.checks[0].kind = "runtime";
    assert.throws(() => record(start(), data), /at least one code check/);
  });

  it("discovers omitted untracked UI files in Git", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, "page.html"), "<button>Save</button>");
    assert.ok(record(start(), evidence()).gates.V.evidence.files.includes("page.html"));
  });
  it("rejects newly added files after V in Git", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const sessionId = start();
    record(sessionId, evidence());
    fs.writeFileSync(path.join(root, "new.js"), "new code");
    assert.throws(() => recordGate(root, "C", true, { sessionId }), /Code changed/);
  });
  it("keeps claimed parallel sessions independent", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const sessionId = start();
    claimPaths(root, ["server.js"], { sessionId });
    fs.writeFileSync(path.join(root, "other.tsx"), "other session");
    record(sessionId, evidence());
    fs.writeFileSync(path.join(root, "other.tsx"), "other session changed");
    assert.equal(recordGate(root, "C", true, { sessionId }).taskActive, false);
  });
  it("rejects paths outside the repository and empty observations", () => {
    const sessionId = start();
    assert.throws(() => record(sessionId, evidence(["../outside.js"])), /inside the project/);
    const data = evidence();
    data.checks[0].observed = " ";
    assert.throws(() => record(sessionId, data), /Each verification check/);
  });

  it("does not leak internal fingerprints or retain V after malformed rechecks", () => {
    const sessionId = start();
    const result = record(sessionId, evidence());
    assert.equal(result.gates.V.snapshot, undefined);
    assert.ok(result.gates.V.evidence);
    assert.throws(() => record(sessionId), /requires evidence/);
    assert.equal(gateStatus(root, { sessionId }).gates.V.complete, false);
    assert.throws(() => recordGate(root, "C", true, { sessionId }), /requires Gate V/);
  });

  it("blocks a Lua forward-reference defect before independent review", () => {
    fs.writeFileSync(path.join(root, "server.lua"), [
      "local function playerDropped()",
      "  syncDatatableNeeds()",
      "end",
      "",
      "local function syncDatatableNeeds()",
      "end",
    ].join("\n"));
    const session = startTask(root, { kind: "fix", note: "fix disconnect save" });
    recordGate(root, "A", true, { sessionId: session.sessionId, note: "fix disconnect save" });
    recordGate(root, "B", true, { sessionId: session.sessionId });
    assert.throws(
      () => record(session.sessionId, evidence(["server.lua"])),
      /Lua lexical-scope verification failed.*syncDatatableNeeds/,
    );
  });

  it("requires a strict fresh independent review for normal Lua fixes", () => {
    fs.writeFileSync(path.join(root, "server.lua"), [
      "local function syncDatatableNeeds()",
      "end",
      "",
      "local function playerDropped()",
      "  syncDatatableNeeds()",
      "end",
    ].join("\n"));
    const session = startTask(root, { kind: "fix", note: "fix disconnect save" });
    recordGate(root, "A", true, { sessionId: session.sessionId, note: "fix disconnect save" });
    recordGate(root, "B", true, { sessionId: session.sessionId });
    assert.throws(
      () => record(session.sessionId, evidence(["server.lua"])),
      /automatic independent reviewer/,
    );

    independentReview.recordReview(root, {
      sessionId: session.sessionId,
      session,
      files: ["server.lua"],
      reviewer: { agent: "reviewer", cliId: "codex" },
      output: "No blocking defect, but one caveat.\nVERDICT: VERIFIED WITH CAVEATS",
    });
    assert.throws(
      () => record(session.sessionId, evidence(["server.lua"])),
      /did not verify/,
    );

    independentReview.recordReview(root, {
      sessionId: session.sessionId,
      session,
      files: ["server.lua"],
      reviewer: { agent: "reviewer", cliId: "codex" },
      output: "Reviewed current source and callers.\nVERDICT: VERIFIED",
    });
    assert.equal(record(session.sessionId, evidence(["server.lua"])).gates.V.complete, true);

    fs.appendFileSync(path.join(root, "server.lua"), "\n-- changed after review\n");
    recordGate(root, "A", true, { sessionId: session.sessionId, note: "re-open after edit" });
    recordGate(root, "B", true, { sessionId: session.sessionId });
    assert.throws(
      () => record(session.sessionId, evidence(["server.lua"])),
      /Gate V review is stale/,
    );
  });

  it("UI declaration disables trivial bypass and upgrades active sessions", () => {
    const ui = startTask(root, { ui: true, trivial: true });
    assert.equal(ui.trivial, false);
    assert.equal(ui.gates.A, undefined);
    const sessionId = start();
    record(sessionId, evidence());
    const upgraded = startTask(root, { sessionId, ui: true });
    assert.equal(upgraded.ui, true);
    assert.equal(upgraded.gates.V, undefined);
  });
});
