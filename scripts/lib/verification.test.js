const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { startTask, recordGate, gateStatus, claimPaths } = require("../fxmind-tools");

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
  it("rejects build-only UI verification even if browser.required is false", () => {
    fs.writeFileSync(path.join(root, "App.tsx"), "export const App = () => <button>Save</button>;");
    const data = evidence(["App.tsx"]);
    data.browser = { required: false };
    assert.throws(() => record(start(), data), /UI changes require browser/);
  });
  it("keeps backend-driven UI verification blocked when browser is unavailable", () => {
    const sessionId = start({ ui: true });
    const data = evidence();
    data.browser = { status: "blocked", reason: "Preview requires an unavailable login" };
    assert.equal(record(sessionId, data).gates.V.complete, false);
    assert.throws(() => recordGate(root, "C", true, { sessionId }), /requires Gate V/);
  });
  it("requires real artifact files and all browser observations", () => {
    const sessionId = start({ ui: true });
    const data = evidence();
    data.browser = { status: "passed", url: "http://localhost/settings", interactions: ["Saved and reloaded the setting"], visual: "No clipped controls", console: "No new runtime errors", artifact: "trace.json" };
    assert.throws(() => record(sessionId, data), /ENOENT/);
    fs.writeFileSync(path.join(root, "trace.json"), "");
    assert.throws(() => record(sessionId, data), /non-empty/);
    // A synthetic artifact validates the contract; it does not prove browser execution.
    fs.writeFileSync(path.join(root, "trace.json"), '{"fixture":true}');
    assert.equal(record(sessionId, data).gates.V.complete, true);
    delete data.browser.visual;
    assert.throws(() => record(sessionId, data), /requires url/);
  });
  it("discovers omitted untracked UI files in Git", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, "page.html"), "<button>Save</button>");
    assert.throws(() => record(start(), evidence()), /UI changes require browser/);
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
