"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runReviewerWithFallback } = require("./reviewer-routing");

describe("Gate V reviewer fallback", () => {
  const opts = { agent: "reviewer", preferredCliId: "cursor-agent", prompt: "Review robberys", paths: ["robberys.lua"] };
  it("uses primary when verified and does not duplicate paid reviews", async () => {
    const seen = [];
    const result = await runReviewerWithFallback("/repo", opts, async (_, args) => {
      seen.push(args.preferredCliId);
      return { ok: true, output: "Review done\nVERDICT: VERIFIED" };
    });
    assert.equal(result.ok, true);
    assert.deepEqual(seen, ["cursor-agent"]);
  });
  it("retries on Codex when primary CLI cannot return text or fails MCP", async () => {
    const seen = [];
    const result = await runReviewerWithFallback("/repo", opts, async (_, args) => {
      seen.push(args);
      if (args.preferredCliId === "cursor-agent") return { ok: false, error: "TLS certificate error" };
      return { ok: true, output: "Found a defect\nVERDICT: REFUTED", cliId: "codex" };
    });
    assert.equal(result.ok, true);
    assert.equal(result.cliId, "codex");
    assert.deepEqual(seen.map(x => x.preferredCliId), ["cursor-agent", "codex"]);
    assert.deepEqual(seen[0].paths, seen[1].paths);
    assert.equal(seen[0].prompt, seen[1].prompt);
  });
  it("does not misreport success if both providers fail", async () => {
    const result = await runReviewerWithFallback("/repo", opts, async (_, x) =>
      ({ ok: false, error: x.preferredCliId + " unavailable" }));
    assert.equal(result.ok, false);
    assert.match(result.error, /cursor-agent unavailable/);
    assert.match(result.error, /codex unavailable/);
  });
  it("does not retry a failing Codex reviewer with itself", async () => {
    let calls = 0;
    const result = await runReviewerWithFallback("/repo", { ...opts, preferredCliId: "codex" }, async () => {
      calls++;
      return { ok: false, error: "failed" };
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  });
});
