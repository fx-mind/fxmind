"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { learnAfterGate, topicFor } = require("./auto-memory");
const atomic = require("./atomic-memory");
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-auto-learn-"));
  fs.mkdirSync(path.join(root, "resources", "[ecco]", "robberys", "server-side"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const rel = "resources/[ecco]/robberys/server-side/server.lua";
const body = 'RegisterNetEvent("robberys:ready")\nlocal function verifyRobbery() return true end\n';
function session() {
  fs.writeFileSync(path.join(root, rel), body);
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  return { kind: "mechanic", gates: {
    C: { complete: true },
    V: { complete: true, snapshot: { [rel]: hash },
      evidence: { independentReview: { verdict: "verified" }, checks: [{ kind: "test", status: "passed" }] } },
  } };
}
const config = { enabled: true, memoryEnabled: true, apiKey: "example-test-key", minConfidence: .75, timeoutMs: 400, model: "jev-latest" };
const reply = (choice = "save", confidence = .92) =>
  ({ ok: true, json: async () => ({ answers: { preserve: { choice, confidence } } }) });

describe("verified auto-memory learning", () => {
  it("never learns without fully verified Gate V/C", async () => {
    assert.equal(topicFor([rel]), "robberys");
    const s = session();
    s.gates.V.complete = false;
    assert.equal((await learnAfterGate(root, s, { config })).reason, "no_verified_gate_v");
    assert.equal(atomic.readAtomic(root), null);
  });
  it("learns atomic verified facts with local provenance and no topic append", async () => {
    const s = session();
    const result = await learnAfterGate(root, s, { config: { ...config, enabled: false } });
    assert.equal(result.status, "learned");
    assert.equal(result.mode, "atomic");
    const data = atomic.readAtomic(root);
    assert.ok(data.nodes.some((n) => n.group === "verified-atom" && n.name === "verifyRobbery"));
    assert.ok(data.nodes.some((n) => n.group === "verified-atom" && n.name === "robberys:ready"));
    assert.equal(fs.existsSync(path.join(root, ".fxmind", "memory", "robberys.md")), false);
    assert.ok(fs.existsSync(path.join(root, ".fxmind", "graph", "verified-atoms.json")));
    assert.equal((await learnAfterGate(root, s, { config: { ...config, enabled: false } })).status, "indexed");
  });
  it("preserves manually maintained notes", async () => {
    const s = session();
    const target = path.join(root, ".fxmind", "memory", "robberys.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "---\ntopic: robberys\n---\n# Human-verified facts\n");
    const old = fs.readFileSync(target, "utf8");
    await learnAfterGate(root, s, { config: { ...config, enabled: false } });
    assert.equal(fs.readFileSync(target, "utf8"), old);
  });
  it("rejects stale snapshots, failures and too many unverified files", async () => {
    const s = session();
    fs.appendFileSync(path.join(root, rel), "-- edited after verification\n");
    assert.equal((await learnAfterGate(root, s)).reason, "stale_or_unsupported_files");
    fs.writeFileSync(path.join(root, rel), body);
    s.gates.V.evidence.checks[0].status = "blocked";
    assert.equal((await learnAfterGate(root, s)).reason, "no_verified_gate_v");
  });
  it("optional Jev never receives code or paths and cannot veto verified indexing", async () => {
    const s = session();
    let sent;
    const got = await learnAfterGate(root, s, {
      config, fetch: async (_, init) => { sent = JSON.parse(init.body); return reply("skip", .99); },
    });
    assert.equal(got.status, "learned");
    assert.equal(got.jevRecommendation, "skip");
    assert.equal(sent.state.resource, "robberys");
    assert.ok(!JSON.stringify(sent).includes("server-side"));
    assert.ok(!JSON.stringify(sent).includes("robberys:ready"));
  });
  it("marks verified facts stale when their source changes", async () => {
    const s = session();
    await learnAfterGate(root, s, { config: { ...config, enabled: false } });
    fs.writeFileSync(path.join(root, rel), body.replace("verifyRobbery", "verifyAttempt"));
    const data = atomic.buildAtomic(root);
    assert.ok(!data.nodes.some((n) => n.group === "verified-atom" && n.name === "verifyRobbery"));
    assert.ok(data.nodes.some((n) => n.group === "code-symbol" && n.name === "verifyAttempt"));
  });
});
