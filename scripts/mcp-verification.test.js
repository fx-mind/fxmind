const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

it("MCP transports evidence and rejects false completion through the public tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-verify-"));
  fs.writeFileSync(path.join(root, "server.js"), "module.exports = 'save';");
  const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
    cwd: root, env: { ...process.env, FXMIND_TARGET: root, FXMIND_SESSION_ID: "" },
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
    const started = JSON.parse((await call("fxmind_start_task", { trivial: true })).content[0].text);
    const sessionId = started.sessionId;
    assert.equal((await call("fxmind_record_gate", { gate: "V", sessionId, note: "Everything is fine" })).isError, true);
    const evidence = {
      files: ["server.js"], review: "Fixture source inspected",
      checks: [{ kind: "manual", target: "server.js", expected: "exports save", observed: "literal export is save", status: "passed" }],
    };
    const verified = JSON.parse((await call("fxmind_record_gate", { gate: "V", sessionId, evidence })).content[0].text);
    assert.equal(verified.gates.V.complete, true);
    fs.writeFileSync(path.join(root, "server.js"), "module.exports = 'changed';");
    assert.equal((await call("fxmind_record_gate", { gate: "C", sessionId })).isError, true);
  } finally {
    lines.close();
    child.stdin.end();
    await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
