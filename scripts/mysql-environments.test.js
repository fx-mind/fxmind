const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const driver = require("mysql2/promise");
const mysql = require("./fxmind-mysql");
const { listTools, TOOL_DEFS } = require("./mcp-server");

describe("MySQL environment selection", () => {
  let root, savedEnv, createConnection, connections;
  const writeEnv = (extra = "") => fs.writeFileSync(path.join(root, ".env"),
    `FXMIND_MYSQL_PRODUCTION_URL="mysql://reader:prod%23secret@production.example:3307/live"\n${extra}`);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmysql-env-"));
    fs.mkdirSync(path.join(root, "dev"));
    fs.writeFileSync(path.join(root, "dev", "dev.cfg"),
      'set mysql_connection_string "server=development.example;uid=dev;password=dev-secret;database=development"');
    savedEnv = { ...process.env };
    for (const key of ["FXMIND_MYSQL_URL", "MYSQL_CONNECTION_STRING", "FXMIND_MYSQL_PRODUCTION_URL"]) delete process.env[key];
    createConnection = driver.createConnection;
    connections = [];
    driver.createConnection = async (config) => {
      const connection = { config, queries: [], ended: false };
      connections.push(connection);
      return {
        async query(sql, params) {
          connection.queries.push({ sql, params });
          return [[{ id: 1, current_db: config.database, version: "test", exact_rows: 1 }], [{ name: "id" }]];
        },
        async end() { connection.ended = true; },
      };
    };
  });

  afterEach(() => {
    driver.createConnection = createConnection;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps the current dev cfg as default and selects production only explicitly", async () => {
    writeEnv();
    const dev = mysql.status({ root });
    const prod = mysql.status({ root, environment: "production" });
    assert.equal(dev.config.database, "development");
    assert.equal(dev.config.environment, "dev");
    assert.equal(dev.config.readOnly, false);
    assert.equal(prod.config.database, "live");
    assert.equal(prod.config.host, "production.example");
    assert.equal(prod.config.source, ".env:FXMIND_MYSQL_PRODUCTION_URL");
    assert.equal(prod.config.environment, "production");
    assert.equal(prod.config.readOnly, true);
    assert.equal(/prod#secret|prod%23secret|dev-secret/.test(JSON.stringify([dev, prod])), false);
    assert.equal(process.env.FXMIND_MYSQL_PRODUCTION_URL, undefined);
    const result = await mysql.executeSql("SELECT 1", { root, environment: "production" });
    assert.equal(result.ok, true);
    assert.equal(connections[0].config.password, "prod#secret");
    assert.equal(connections[0].config.port, 3307);
    assert.equal(mysql.status({ root }).config.environment, "dev");
  });

  it("never falls back to dev, generic env, mysql.json or connection overrides when production is missing", async () => {
    fs.mkdirSync(path.join(root, ".fxmind"));
    fs.writeFileSync(path.join(root, ".fxmind", "mysql.json"), JSON.stringify({ url: "mysql://dev:secret@json.example/dev" }));
    process.env.FXMIND_MYSQL_URL = "mysql://dev:secret@env.example/dev";
    const options = { root, environment: "production", connectionString: "mysql://dev:secret@override.example/dev" };
    assert.equal(mysql.status(options).configured, false);
    const result = await mysql.executeSql("SELECT 1", options);
    assert.equal(result.ok, false);
    assert.match(result.error, /FXMIND_MYSQL_PRODUCTION_URL/);
    assert.equal(result.config.environment, "production");
    assert.equal(connections.length, 0);
  });

  it("rejects incomplete production URLs instead of defaulting to localhost", async () => {
    for (const raw of ["oops", "password=private-secret;database=live", "mysql://reader:private-secret@production.example", "server=production.example;database=live;port=NaN"]) {
      fs.writeFileSync(path.join(root, ".env"), `FXMIND_MYSQL_PRODUCTION_URL="${raw}"`);
      const result = mysql.status({ root, environment: "production" });
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes("private-secret"), false);
      assert.equal((await mysql.executeSql("SELECT 1", { root, environment: "production" })).ok, false);
    }
    assert.equal(connections.length, 0);
  });

  it("supports env precedence, oxmysql strings and live .env updates", () => {
    writeEnv('FXMIND_MYSQL_URL="mysql://dev:secret@dotenv-dev.example/custom_dev"');
    assert.equal(mysql.status({ root }).config.database, "custom_dev");
    process.env.FXMIND_MYSQL_PRODUCTION_URL = "server=env-production.example;uid=reader;password=secret;database=env_live";
    assert.equal(mysql.status({ root, environment: "production" }).config.database, "env_live");
    assert.equal(mysql.status({ root, environment: "production" }).config.source, "env:FXMIND_MYSQL_PRODUCTION_URL");
    delete process.env.FXMIND_MYSQL_PRODUCTION_URL;
    fs.writeFileSync(path.join(root, ".env"), "FXMIND_MYSQL_PRODUCTION_URL=mysql://reader:secret@new-production.example/new_live");
    assert.equal(mysql.status({ root, environment: "production" }).config.database, "new_live");
  });

  it("forces every production read helper into a read-only transaction and closes its connection", async () => {
    writeEnv();
    const options = { root, environment: "production", readOnly: false };
    const results = [
      await mysql.executeSql("SELECT * FROM users", options),
      await mysql.getSchemaInfo(options),
      await mysql.getSchemaInfo({ ...options, table_name: "users" }),
      await mysql.getTableSample({ ...options, table_name: "users" }),
      await mysql.exploreDatabase(options),
      await mysql.analyzeTable({ ...options, table_name: "users" }),
    ];
    assert.equal(connections.length, 6);
    for (const result of results) {
      assert.equal(result.ok, true);
      assert.equal(result.config.environment, "production");
      assert.equal(result.config.readOnly, true);
    }
    for (const conn of connections) {
      assert.equal(conn.config.host, "production.example");
      assert.equal(conn.config.multipleStatements, false);
      assert.equal(conn.queries[0].sql, "START TRANSACTION READ ONLY");
      assert.equal(conn.queries.at(-1).sql, "ROLLBACK");
      assert.equal(conn.ended, true);
    }
  });

  it("blocks production writes regardless of approval and rejects unknown environments", async () => {
    writeEnv();
    for (const query of ["UPDATE users SET id=2", "INSERT INTO users VALUES (1)", "DELETE FROM users", "DROP TABLE users", "CALL mutate_users()", "SELECT 1 INTO OUTFILE '/tmp/data'", "WITH c AS (SELECT 1) UPDATE users SET id=2", "/*!50000 DELETE FROM users */ SELECT 1"]) {
      const result = await mysql.executeSql(query, { root, environment: "production", approvedByUser: true, readOnly: false });
      assert.equal(result.ok, false, query);
      assert.equal(result.readOnly, true);
    }
    assert.equal((await mysql.executeSql("UPDATE users SET id=2", { root, environment: "prod-typo" })).ok, false);
    assert.equal(mysql.status({ root, environment: "prod-typo" }).ok, false);
    assert.equal(connections.length, 0);
    assert.equal((await mysql.executeSql("UPDATE users SET id=2", { root })).ok, true);
    assert.equal(connections[0].config.host, "development.example");
    assert.equal(connections[0].queries.length, 1);
  });

  it("rolls back and closes production connections after query failures", async () => {
    writeEnv();
    const queries = [];
    let ended = false;
    driver.createConnection = async () => ({
      async query(sql) {
        queries.push(sql);
        if (sql.startsWith("SELECT")) throw new Error("query failed");
        return [[], []];
      },
      async end() { ended = true; },
    });
    const result = await mysql.executeSql("SELECT 1", { root, environment: "production" });
    assert.equal(result.ok, false);
    assert.deepEqual(queries, ["START TRANSACTION READ ONLY", "SELECT 1", "ROLLBACK"]);
    assert.equal(ended, true);
  });

  it("lists DB tools with production alone and advertises environment selection for all six tools", () => {
    fs.rmSync(path.join(root, "dev", "dev.cfg"));
    writeEnv();
    const names = listTools(root).map((tool) => tool.name);
    assert.ok(names.includes("fxmind_db_query"));
    const dbTools = TOOL_DEFS.filter((tool) => tool.name.startsWith("fxmind_db_"));
    assert.equal(dbTools.length, 6);
    for (const tool of dbTools) assert.deepEqual(tool.inputSchema.properties.environment.enum, ["dev", "production"]);
  });

  it("selects production over MCP stdio and blocks approved writes through the public tool", async () => {
    writeEnv();
    const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
      cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FXMIND_TARGET: root, FXMIND_MCP_READONLY: "0" },
    });
    const lines = readline.createInterface({ input: child.stdout });
    let id = 0;
    const pending = new Map();
    lines.on("line", (line) => { const msg = JSON.parse(line); pending.get(msg.id)?.(msg.result); });
    const call = (name, args) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error("MCP timeout")), 10000);
      pending.set(requestId, (result) => { clearTimeout(timer); pending.delete(requestId); resolve(result); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } }) + "\n");
    });
    try {
      const status = await call("fxmind_db_status", { environment: "production" });
      assert.equal(JSON.parse(status.content[0].text).config.database, "live");
      assert.equal(status.content[0].text.includes("prod#secret"), false);
      const denied = await call("fxmind_db_query", { environment: "production", query: "DELETE FROM users", approvedByUser: true });
      assert.equal(denied.isError, true);
      assert.equal(JSON.parse(denied.content[0].text).readOnly, true);
      const dev = await call("fxmind_db_status", {});
      assert.equal(JSON.parse(dev.content[0].text).config.environment, "dev");
    } finally {
      lines.close();
      const exit = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exit;
    }
  });

  it("supports explicit production selection in the CLI and keeps --yes unable to enable writes", () => {
    writeEnv();
    const entry = path.join(__dirname, "install.js");
    const env = { ...process.env, FXMIND_TARGET: root };
    const status = spawnSync(process.execPath, [entry, "db", "status", "--environment", "production", "--json"], { cwd: root, env, encoding: "utf8", windowsHide: true });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).config.environment, "production");
    const denied = spawnSync(process.execPath, [entry, "db", "query", "DELETE FROM users", "--environment", "production", "--yes", "--json"], { cwd: root, env, encoding: "utf8", windowsHide: true });
    assert.equal(denied.status, 1);
    assert.equal(JSON.parse(denied.stdout).readOnly, true);
  });
});
