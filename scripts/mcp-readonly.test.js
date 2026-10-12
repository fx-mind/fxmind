const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { listTools } = require("./mcp-server");
const mysql = require("./fxmind-mysql");

it("read-only mode lists only tools that never write", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-ro-"));
  const names = listTools(root, { FXMIND_MCP_READONLY: "1", FXMIND_MCP_TOOLS: "all" }).map((tool) => tool.name);
  assert.ok(names.includes("fxmind_db_query"));
  assert.ok(names.includes("fxmind_search"));
  for (const writer of ["fxmind_fivem_cmd", "fxmind_fivem_install", "fxmind_record_gate", "fxmind_subagent_run", "fxmind_graph"]) {
    assert.ok(!names.includes(writer), `${writer} não pode aparecer em modo somente leitura`);
  }
  const full = listTools(root, { FXMIND_MCP_TOOLS: "all" }).map((tool) => tool.name);
  assert.ok(full.includes("fxmind_fivem_cmd"));
});

it("read-only SQL accepts one read and refuses writes", async () => {
  assert.equal(mysql.readOnlyViolation("SELECT name FROM manager_shops WHERE permission LIKE '%LabubuCafe%'"), null);
  assert.equal(mysql.readOnlyViolation("SELECT 'drop table' AS t"), null);
  for (const sql of [
    "UPDATE t SET a = 1",
    "WITH c AS (SELECT 1) UPDATE t SET a = 1",
    "SELECT * FROM t INTO OUTFILE '/tmp/x'",
    "SELECT 1; DROP TABLE t",
    "/*!50000 DROP TABLE t */ SELECT 1",
    "SELECT * FROM t FOR UPDATE",
  ]) {
    assert.notEqual(mysql.readOnlyViolation(sql), null, sql);
  }
  const refused = await mysql.executeSql("DELETE FROM t", { readOnly: true, approvedByUser: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.readOnly, true);
});

it("read-only server refuses a write tool even when called directly", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-ro-call-"));
  const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
    cwd: root, env: { ...process.env, NODE_ENV: "test", FXMIND_TARGET: root, FXMIND_MCP_READONLY: "1" },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const lines = readline.createInterface({ input: child.stdout });
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("MCP timeout")), 10000);
      lines.on("line", (line) => { clearTimeout(timeout); resolve(JSON.parse(line)); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fxmind_fivem_cmd", arguments: { command: "restart x" } } }) + "\n");
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /read-only/);
  } finally {
    child.kill();
  }
});
