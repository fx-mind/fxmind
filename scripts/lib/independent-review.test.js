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
    assert.equal(review.parseVerdict("MCP unavailable\nVERDICT: UNVERIFIABLE"), "unverifiable");
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

  it("loads code references without importing broad skill gates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-review-skills-"));
    try {
      fs.mkdirSync(path.join(root, ".fxmind", "policy"), { recursive: true });
      fs.mkdirSync(path.join(root, ".fxmind", "skills", "fivem-development"), { recursive: true });
      fs.mkdirSync(path.join(root, ".fxmind", "skills", "vrp-framework"), { recursive: true });
      fs.writeFileSync(path.join(root, ".fxmind", "policy", "fivem-principles.md"), "C5 Lexical locals binding");
      fs.writeFileSync(path.join(root, ".fxmind", "skills", "fivem-development", "SKILL.md"), "FiveM skill router");
      fs.writeFileSync(path.join(root, ".fxmind", "skills", "fivem-development", "quality-gates.md"), "Quality gates C1-C8");
      fs.writeFileSync(path.join(root, ".fxmind", "skills", "fivem-development", "style.md"), "callee before caller");
      fs.writeFileSync(path.join(root, ".fxmind", "skills", "vrp-framework", "patterns.md"), "vRP framework rules");
      const prompt = review.buildPrompt(
        root,
        { taskActive: true, sessionId: "s", kind: "fix", note: "fix vrp save" },
        ["vrp/modules/base.lua"],
        { checks: [{ kind: "test", target: "disconnect unit test", status: "passed", observed: "no error" }] },
      );
      assert.doesNotMatch(prompt, /C5 Lexical locals binding/);
      assert.doesNotMatch(prompt, /Quality gates C1-C8/);
      assert.match(prompt, /callee before caller/);
      assert.match(prompt, /vRP framework rules/);
      assert.match(prompt, /Executor observations \(claims; verify independently\)/);
      assert.doesNotMatch(prompt, /executor's explanation.*correct/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("prioritizes lint and code quality without loading UI-only rules for build/backend files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-review-scope-"));
    try {
      const dir = path.join(root, ".fxmind", "skills", "fivem-react-nui");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), "UI_ONLY_ROUTER_MUST_NOT_LOAD_FOR_BUILD");
      const prompt = review.buildPrompt(root, {}, ["scripts/build.js"], {
        ui: { changed: false, reason: "Only build tooling changed; output UI is identical." },
        checks: [{ kind: "lint", target: "project lint", status: "passed", observed: "no errors" }],
      });
      assert.match(prompt, /Check lint\/syntax, applicable types/);
      assert.match(prompt, /Do not open a browser/);
      assert.match(prompt, /Block only on a concrete code defect/);
      assert.doesNotMatch(prompt, /UI_ONLY_ROUTER_MUST_NOT_LOAD_FOR_BUILD/);
      assert.doesNotMatch(review.reviewGuidance(root, ["scripts/build.js"]), /UI_ONLY_ROUTER_MUST_NOT_LOAD_FOR_BUILD/);
      const uiPrompt = review.buildPrompt(root, {}, ["web/App.tsx"], {
        ui: { changed: true, reason: "Changed the rendered button label." },
      });
      assert.doesNotMatch(uiPrompt, /UI_ONLY_ROUTER_MUST_NOT_LOAD_FOR_BUILD/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps code review independent of optional UI metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-review-impact-"));
    try {
      fs.writeFileSync(path.join(root, "App.tsx"), "export const App = () => <button>Save</button>;");
      const session = { sessionId: "ui-impact", kind: "fix", trivial: false };
      const evidence = { ui: { changed: true, reason: "Changed the save button." } };
      review.recordReview(root, { sessionId: session.sessionId, session, files: ["App.tsx"], evidence,
        reviewer: { agent: "reviewer" }, output: "VERDICT: VERIFIED" });
      assert.equal(review.assertVerifiedFresh(root, session, ["App.tsx"], evidence).verdict, "verified");
      assert.equal(review.assertVerifiedFresh(root, { ...session, ui: true }, ["App.tsx"], {
        ui: { changed: false, reason: "Do not open the browser." },
      }).verdict, "verified");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("ignores runtime claims and scopes findings to code even for UI tasks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-review-code-"));
    try {
      const prompt = review.buildPrompt(root, { kind: "fix", ui: true }, ["App.tsx"], {
        checks: [{ kind: "runtime", target: "GAMEPLAY_UNAVAILABLE", status: "blocked" }],
        browser: { status: "blocked", reason: "BROWSER_UNAVAILABLE" },
      });
      assert.match(prompt, /concrete code defect, with file:line/);
      assert.match(prompt, /MCP\/memory is optional/);
      assert.match(prompt, /VERDICT: UNVERIFIABLE/);
      assert.doesNotMatch(prompt, /GAMEPLAY_UNAVAILABLE|BROWSER_UNAVAILABLE/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
