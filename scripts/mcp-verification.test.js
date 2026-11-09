const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, execFileSync } = require("child_process");

for (const reviewerResult of ["verified", "refuted", "unverifiable"]) {
  it(`MCP code verification handles ${reviewerResult} without demanding runtime proof`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-verify-"));
    fs.writeFileSync(path.join(root, "server.js"), "module.exports = 'save';");
    const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
      cwd: root, env: { ...process.env, NODE_ENV: "test", FXMIND_TARGET: root, FXMIND_SESSION_ID: "", FXMIND_AGENT_ID: "codex", FXMIND_TEST_REVIEWER_RESULT: reviewerResult },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const lines = readline.createInterface({ input: child.stdout });
    const pending = new Map();
    let id = 0;
    lines.on("line", (line) => {
      const response = JSON.parse(line);
      pending.get(response.id)?.(response);
    });
    const call = (name, args = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`MCP timeout: ${name}`)); }, 10000);
      pending.set(requestId, (response) => {
        clearTimeout(timeout);
        pending.delete(requestId);
        resolve(response.result);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } }) + "\n");
    });
    try {
      const search = JSON.parse((await call("fxmind_search", { query: "save" })).content[0].text);
      assert.equal(search.matches[0].file, "server.js");
      const started = JSON.parse((await call("fxmind_start_task", { kind: "fix", ui: true })).content[0].text);
      const sessionId = started.sessionId;
      await call("fxmind_record_gate", { gate: "A", sessionId, note: "Only the server implementation changed; no interface impact." });
      await call("fxmind_record_gate", { gate: "B", sessionId });
      assert.equal((await call("fxmind_record_gate", { gate: "V", sessionId, note: "Everything is fine" })).isError, true);
      const evidence = {
        files: ["server.js"], review: "Fixture source inspected",
        ui: { changed: true, reason: "Server response changes displayed output." },
        browser: { status: "blocked", reason: "No browser available" },
        checks: [{ kind: "lint", target: "node --check server.js", expected: "valid JavaScript syntax", observed: "exit 0", status: "passed" }],
      };
      execFileSync(process.execPath, ["--check", path.join(root, "server.js")]);
      const verified = JSON.parse((await call("fxmind_record_gate", { gate: "V", sessionId, evidence })).content[0].text);
      if (reviewerResult === "verified") {
        assert.equal(verified.gates.V.complete, true);
        assert.equal(verified.gates.V.evidence.scope, "code");
        // An unsuccessful recheck cannot reuse an earlier approval.
        await call("fxmind_record_gate", { gate: "V", sessionId });
        assert.equal((await call("fxmind_record_gate", { gate: "C", sessionId })).isError, true);
        const failed = JSON.parse((await call("fxmind_record_gate", { gate: "V", sessionId,
          evidence: { ...evidence, checks: [{ ...evidence.checks[0], status: "failed" }] },
        })).content[0].text);
        assert.equal(failed.error, "gate_v_code_checks_failed");
        assert.equal((await call("fxmind_record_gate", { gate: "C", sessionId })).isError, true);
        await call("fxmind_record_gate", { gate: "V", sessionId, evidence });
        fs.writeFileSync(path.join(root, "server.js"), "module.exports = 'changed';");
        assert.equal((await call("fxmind_record_gate", { gate: "C", sessionId })).isError, true);
      } else {
        assert.equal(verified.complete, false);
        assert.equal(verified.error, reviewerResult === "refuted" ? "gate_v_review_failed" : "gate_v_reviewer_unavailable");
        assert.equal(verified.action, reviewerResult === "refuted" ? "fix_findings_and_retry_gate_v" : "report_reviewer_unavailable");
        assert.equal((await call("fxmind_record_gate", { gate: "C", sessionId })).isError, true);
        const state = JSON.parse((await call("fxmind_gate_status", { sessionId })).content[0].text);
        assert.equal(state.gates.V.complete, false);
        if (reviewerResult === "unverifiable") assert.equal(state.gates.V.note, "gate_v_reviewer_unavailable");
        // A known tiny task needs code checks, not a second paid CLI review.
        const tiny = JSON.parse((await call("fxmind_start_task", { sessionId: "tiny", trivial: true, kind: "config" })).content[0].text);
        const tinyResult = JSON.parse((await call("fxmind_record_gate", { gate: "V", sessionId: tiny.sessionId, evidence })).content[0].text);
        assert.equal(tinyResult.gates.V.complete, true);
        assert.equal(tinyResult.gates.V.evidence.independentReview, undefined);
      }
    } finally {
      lines.close();
      child.stdin.end();
      await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

}
