const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const taskSessions = require("./task-sessions");
const { startTask, recordGate, claimPaths, gateStatus, sessionStatus } = require("../fxmind-tools");

describe("task-sessions", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxsess-"));
    fs.mkdirSync(path.join(dir, ".fxmind", "memory"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".fxmind", "packs.json"), "{}\n", "utf8");
  });

  it("creates independent sessions without clobbering gates", () => {
    const a = startTask(dir, { note: "task A" });
    const b = startTask(dir, { note: "task B" });
    assert.notEqual(a.sessionId, b.sessionId);

    recordGate(dir, "A", true, { sessionId: a.sessionId, note: "A done" });
    recordGate(dir, "A", true, { sessionId: b.sessionId, note: "B A done" });

    const statusA = gateStatus(dir, { sessionId: a.sessionId });
    const statusB = gateStatus(dir, { sessionId: b.sessionId });
    assert.equal(statusA.gates.A.complete, true);
    assert.equal(statusA.gates.A.note, "A done");
    assert.equal(statusB.gates.A.note, "B A done");
  });

  it("Gate C on one session does not close the other", () => {
    const a = startTask(dir, { note: "A" });
    const b = startTask(dir, { note: "B" });

    for (const id of [a.sessionId, b.sessionId]) {
      recordGate(dir, "A", true, { sessionId: id });
      recordGate(dir, "B", true, { sessionId: id });
      recordGate(dir, "V", true, { sessionId: id });
    }

    recordGate(dir, "C", true, { sessionId: a.sessionId });
    const closed = gateStatus(dir, { sessionId: a.sessionId });
    const open = gateStatus(dir, { sessionId: b.sessionId });
    assert.equal(closed.taskActive, false);
    assert.equal(open.taskActive, true);
  });

  it("claim_paths rejects conflicts and releases on Gate C", () => {
    const a = startTask(dir, { note: "A" });
    const b = startTask(dir, { note: "B" });

    const first = claimPaths(dir, ["resources/radio/client.lua"], { sessionId: a.sessionId });
    assert.equal(first.ok, true);

    const second = claimPaths(dir, ["resources/radio/client.lua"], { sessionId: b.sessionId });
    assert.equal(second.ok, false);
    assert.equal(second.error, "path_conflict");

    recordGate(dir, "A", true, { sessionId: a.sessionId });
    recordGate(dir, "B", true, { sessionId: a.sessionId });
    recordGate(dir, "V", true, { sessionId: a.sessionId });
    recordGate(dir, "C", true, { sessionId: a.sessionId });

    const after = claimPaths(dir, ["resources/radio/client.lua"], { sessionId: b.sessionId });
    assert.equal(after.ok, true);
  });

  it("requires sessionId when multiple sessions are active", () => {
    startTask(dir, { note: "one" });
    startTask(dir, { note: "two" });
    const status = gateStatus(dir, {});
    assert.equal(status.error, "multiple_active_sessions");
    assert.ok(Array.isArray(status.activeSessions));
  });

  it("gatesForHook blocks unclaimed edits when multi-session", () => {
    startTask(dir, { note: "one" });
    startTask(dir, { note: "two" });
    const hook = taskSessions.gatesForHook(dir, { filePath: "resources/a.lua" });
    assert.equal(hook.allow, false);
    assert.equal(hook.reason, "unclaimed");
  });

  it("gatesForHook allows claimed path in multi-session", () => {
    const a = startTask(dir, { note: "one" });
    startTask(dir, { note: "two" });
    claimPaths(dir, ["resources/a.lua"], { sessionId: a.sessionId });
    recordGate(dir, "A", true, { sessionId: a.sessionId });
    recordGate(dir, "B", true, { sessionId: a.sessionId });

    const hook = taskSessions.gatesForHook(dir, { filePath: "resources/a.lua" });
    assert.equal(hook.allow, true);
    assert.equal(hook.session.sessionId, a.sessionId);
  });

  it("sessionStatus lists active sessions", () => {
    startTask(dir, { note: "one" });
    startTask(dir, { note: "two" });
    const status = sessionStatus(dir);
    assert.equal(status.activeCount, 2);
    assert.equal(status.multiSession, true);
    assert.equal(status.sessions.length, 2);
  });
});
