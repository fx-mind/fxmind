const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mysql = require("./fxmind-mysql");

describe("fxmind mysql helpers", () => {
  it("parses oxmysql semicolon connection string", () => {
    const cfg = mysql.parseConnectionString(
      "server=127.0.0.1;uid=root;password=secret;database=blacknetwork;port=3306;charset=utf8mb4",
    );
    assert.equal(cfg.host, "127.0.0.1");
    assert.equal(cfg.user, "root");
    assert.equal(cfg.password, "secret");
    assert.equal(cfg.database, "blacknetwork");
    assert.equal(cfg.port, 3306);
  });

  it("parses mysql URI", () => {
    const cfg = mysql.parseConnectionString("mysql://root:p%40ss@localhost:3307/mydb");
    assert.equal(cfg.host, "localhost");
    assert.equal(cfg.port, 3307);
    assert.equal(cfg.user, "root");
    assert.equal(cfg.password, "p@ss");
    assert.equal(cfg.database, "mydb");
  });

  it("reads mysql_connection_string from cfg", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxmysql-"));
    const cfgPath = path.join(dir, "dev.cfg");
    fs.writeFileSync(
      cfgPath,
      'set mysql_connection_string "server=127.0.0.1;uid=root;password=;database=demo;port=3306"\n',
      "utf8",
    );
    const raw = mysql.readMysqlConnectionStringFromCfg(cfgPath);
    assert.match(raw, /database=demo/);
    const status = mysql.status({ root: dir });
    // no mysql.json / only if we put cfg in candidate path
    fs.mkdirSync(path.join(dir, "dev"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dev", "dev.cfg"), fs.readFileSync(cfgPath));
    const st = mysql.status({ root: dir });
    assert.equal(st.configured, true);
    assert.equal(st.config.database, "demo");
    assert.equal(st.config.passwordSet, false);
  });

  it("flags destructive SQL and allows reads", () => {
    assert.equal(mysql.classifySql("SELECT * FROM users").destructive, false);
    assert.equal(mysql.classifySql("DELETE FROM users WHERE id=1").destructive, true);
    assert.equal(mysql.classifySql("DROP TABLE users").destructive, true);
    assert.equal(mysql.classifySql("TRUNCATE accounts").destructive, true);
  });
});
