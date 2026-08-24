const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isUserStop, lastUserTextFromTranscript, shouldFollowup } = require("./stop-followup");

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
});
