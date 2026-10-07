const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const review = require("./independent-review");

describe("independent review artifact", () => {
  it("accepts only an exact verdict on the final non-empty line", () => {
    assert.equal(review.parseVerdict("Options: VERDICT: REFUTED\nVERDICT: VERIFIED"), "verified");
    assert.equal(review.parseVerdict("VERDICT: VERIFIED\nextra text"), "unverifiable");
    assert.equal(review.parseVerdict("finding\nVERDICT: REFUTED"), "refuted");
  });

  it("binds VERIFIED to the exact reviewed contents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-review-"));
    try {
      fs.mkdirSync(path.join(root, ".fxmind", "state"), { recursive: true });
      fs.writeFileSync(path.join(root, "server.lua"), "local x = 1\n");
      const session = { sessionId: "s1", trivial: false, kind: "fix" };
      review.recordReview(root, {
        sessionId: "s1",
        session,
        files: ["server.lua"],
        reviewer: { agent: "reviewer", cliId: "codex" },
        output: "Looks correct.\nVERDICT: VERIFIED",
      });
      assert.equal(review.assertVerifiedFresh(root, session, ["server.lua"]).verdict, "verified");
      fs.writeFileSync(path.join(root, "server.lua"), "local x = 2\n");
      assert.throws(() => review.assertVerifiedFresh(root, session, ["server.lua"]), /stale/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("invalidates a verified review when the task context changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-review-"));
    try {
      fs.mkdirSync(path.join(root, ".fxmind", "state"), { recursive: true });
      fs.writeFileSync(path.join(root, "server.lua"), "local x = 1\n");
      const session = {
        sessionId: "s-context",
        trivial: false,
        kind: "fix",
        note: "fix disconnect save",
        gates: { A: { note: "fix disconnect save" } },
      };
      review.recordReview(root, {
        sessionId: session.sessionId,
        session,
        files: ["server.lua"],
        reviewer: { agent: "reviewer" },
        output: "Reviewed current task.\nVERDICT: VERIFIED",
      });
      assert.equal(review.assertVerifiedFresh(root, session, ["server.lua"]).verdict, "verified");
      const changedGoal = {
        ...session,
        gates: { A: { note: "change disconnect behavior instead" } },
      };
      assert.throws(
        () => review.assertVerifiedFresh(root, changedGoal, ["server.lua"]),
        /task goal\/kind\/playbook changed/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not accept caveats as a passing review", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-review-"));
    try {
      fs.mkdirSync(path.join(root, ".fxmind", "state"), { recursive: true });
      fs.writeFileSync(path.join(root, "server.lua"), "local x = 1\n");
      const session = { sessionId: "s2", trivial: false, kind: "fix" };
      review.recordReview(root, {
        sessionId: "s2",
        session,
        files: ["server.lua"],
        reviewer: { agent: "reviewer" },
        output: "Potential issue.\nVERDICT: VERIFIED WITH CAVEATS",
      });
      assert.throws(() => review.assertVerifiedFresh(root, session, ["server.lua"]), /did not verify/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
