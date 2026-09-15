const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  GATE_V_REMINDER,
  GATE_C_REMINDER,
  isUserStop,
  isOwnFollowup,
  isAgentHandoff,
  lastUserTextFromTranscript,
  lastAssistantTextFromTranscript,
  claimSessionNag,
  shouldFollowup,
} = require("./stop-followup");

const PLAYBOOK = /ensure\+console_tail|AskQuestion|Never Write|fxmind_record_correction|TWINS:|mudança pontual/;

describe("isUserStop", () => {
  for (const text of ["pare", "Pare.", "STOP", "parar", "para", "pause", "cancela", "chega"]) {
    it(`treats "${text}" as stop`, () => {
      assert.equal(isUserStop(text), true);
    });
  }

  it("treats 'para ai' / 'stop generating' as stop", () => {
    assert.equal(isUserStop("para aí"), true);
    assert.equal(isUserStop("stop generating"), true);
    assert.equal(isUserStop("pode parar"), true);
  });

  it("does not treat normal requests as stop", () => {
    assert.equal(isUserStop("para o servidor de clima"), false);
    assert.equal(isUserStop("stop the rain in weather.lua"), false);
    assert.equal(isUserStop("continua o Gate V"), false);
    assert.equal(isUserStop(""), false);
  });
});

describe("visible reminders", () => {
  it("keeps Gate V/C pings short and free of agent playbooks", () => {
    assert.ok(GATE_V_REMINDER.length < 160);
    assert.ok(GATE_C_REMINDER.length < 160);
    assert.equal(PLAYBOOK.test(GATE_V_REMINDER), false);
    assert.equal(PLAYBOOK.test(GATE_C_REMINDER), false);
    assert.match(GATE_V_REMINDER, /^fxmind: finish Gate V/);
    assert.match(GATE_C_REMINDER, /^fxmind: finish Gate C/);
  });

  it("treats a previous fxmind gate ping as its own follow-up", () => {
    assert.equal(isOwnFollowup(GATE_V_REMINDER), true);
    assert.equal(isOwnFollowup(GATE_C_REMINDER), true);
    assert.equal(isOwnFollowup("fxmind: Gate V (verify by observation) is still pending before Gate C."), true);
    assert.equal(isOwnFollowup("continua o Gate V"), false);
  });
});

describe("isAgentHandoff", () => {
  it("detects a parked Gate V wait for the user", () => {
    const text = [
      "Gate V continua incompleto. Gate C não fecha.",
      "Runtime ensure + console_tail blocked — FXServer não está rodando (serverReachable: false).",
      "Suba o FXServer e avise — aí fecho V + C.",
    ].join("\n");
    assert.equal(isAgentHandoff(text), true);
  });

  it("does not treat a plain completion report as a handoff", () => {
    assert.equal(isAgentHandoff("Fixed the chest load cache. Ready to verify."), false);
    assert.equal(isAgentHandoff(""), false);
  });
});

describe("lastUserTextFromTranscript", () => {
  it("reads JSON message arrays", () => {
    const raw = JSON.stringify({
      messages: [
        { role: "user", content: "fix weather" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "pare" },
      ],
    });
    assert.equal(lastUserTextFromTranscript(raw), "pare");
  });

  it("reads JSONL user rows", () => {
    const raw = [
      JSON.stringify({ role: "user", content: [{ type: "text", text: "fix" }] }),
      JSON.stringify({ role: "assistant", content: "working" }),
      JSON.stringify({ role: "user", content: [{ type: "text", text: "pare" }] }),
    ].join("\n");
    assert.equal(lastUserTextFromTranscript(raw), "pare");
  });
});

describe("lastAssistantTextFromTranscript", () => {
  it("reads the latest assistant turn", () => {
    const raw = JSON.stringify({
      messages: [
        { role: "user", content: "fix weather" },
        { role: "assistant", content: "Gate V blocked. Suba o FXServer e avise." },
      ],
    });
    assert.match(lastAssistantTextFromTranscript(raw), /Gate V blocked/);
  });
});

describe("shouldFollowup", () => {
  it("nags once on a normal completed turn", () => {
    assert.equal(shouldFollowup({ status: "completed", loop_count: 0, lastUserText: "fix lua" }), true);
  });

  it("never nags after user abort/error", () => {
    assert.equal(shouldFollowup({ status: "aborted", loop_count: 0, lastUserText: "fix lua" }), false);
    assert.equal(shouldFollowup({ status: "error", loop_count: 0, lastUserText: "fix lua" }), false);
  });

  it("caps follow-ups so the reminder cannot loop", () => {
    assert.equal(shouldFollowup({ status: "completed", loop_count: 1, lastUserText: "fix lua" }), false);
  });

  it("does not nag when the user asked to stop", () => {
    assert.equal(shouldFollowup({ status: "completed", loop_count: 0, lastUserText: "pare" }), false);
  });

  it("does not re-inject when the last user turn was already a gate ping", () => {
    assert.equal(
      shouldFollowup({ status: "completed", loop_count: 0, lastUserText: GATE_V_REMINDER }),
      false,
    );
  });

  it("does not nag after the agent handed verification back to the user", () => {
    assert.equal(
      shouldFollowup({
        status: "completed",
        loop_count: 0,
        lastUserText: "migra o bau",
        lastAssistantText: "Gate V continua incompleto (serverReachable: false). Suba o FXServer e avise.",
      }),
      false,
    );
  });
});

describe("claimSessionNag", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fxnag-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allows one nag per task session", () => {
    assert.equal(claimSessionNag(tmpDir, "sess-1"), true);
    assert.equal(claimSessionNag(tmpDir, "sess-1"), false);
    assert.equal(claimSessionNag(tmpDir, "sess-2"), true);
  });
});
