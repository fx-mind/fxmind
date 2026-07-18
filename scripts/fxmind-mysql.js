/**
 * fxmind MySQL — read connection from FiveM cfg (oxmysql mysql_connection_string).
 *
 * Destructive SQL (DELETE / DROP / TRUNCATE / ALTER … DROP) requires
 * approvedByUser: true after the agent gets explicit user approval.
 */

const fs = require("fs");
const path = require("path");

const CFG_CANDIDATES = [
  "dev/dev.cfg",
  "server.cfg",
  "cfg/server.cfg",
  "dev.cfg",
];

const DESTRUCTIVE_RE =
  /\b(DELETE\b|DROP\b|TRUNCATE\b|ALTER\s+TABLE\b[\s\S]*\bDROP\b|REPLACE\s+INTO\b)/i;

let mysql2;
function getMysql2() {
  if (mysql2) return mysql2;
  try {
    mysql2 = require("mysql2/promise");
  } catch (error) {
    const err = new Error(
      'mysql2 is required for DB tools — run: npm install mysql2 (in the fxmind package)',
    );
    err.cause = error;
    throw err;
  }
  return mysql2;
}

function projectRoot(overrides = {}) {
  return path.resolve(
    overrides.root ||
      process.env.FXMIND_TARGET ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
}

function readMysqlConnectionStringFromCfg(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(
    /^\s*(?:set\s+)?mysql_connection_string\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/im,
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function resolveConnectionString(root) {
  if (process.env.FXMIND_MYSQL_URL) {
    return { raw: process.env.FXMIND_MYSQL_URL, source: "env:FXMIND_MYSQL_URL" };
  }
  if (process.env.MYSQL_CONNECTION_STRING) {
    return {
      raw: process.env.MYSQL_CONNECTION_STRING,
      source: "env:MYSQL_CONNECTION_STRING",
    };
  }
  for (const rel of CFG_CANDIDATES) {
    const abs = path.join(root, rel);
    const raw = readMysqlConnectionStringFromCfg(abs);
    if (raw) return { raw, source: rel };
  }
  const localJson = path.join(root, ".fxmind", "mysql.json");
  if (fs.existsSync(localJson)) {
    try {
      const data = JSON.parse(fs.readFileSync(localJson, "utf8"));
      if (data.url || data.connectionString) {
        return {
          raw: String(data.url || data.connectionString),
          source: ".fxmind/mysql.json",
        };
      }
    } catch {
      // ignore
    }
  }
  return { raw: null, source: null };
}

/**
 * Parse oxmysql semicolon string or mysql:// URI into mysql2 config.
 */
function parseConnectionString(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  if (/^mysql:\/\//i.test(text)) {
    const u = new URL(text);
    return {
      host: u.hostname || "127.0.0.1",
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username || "root"),
      password: decodeURIComponent(u.password || ""),
      database: (u.pathname || "").replace(/^\//, "") || undefined,
      charset: u.searchParams.get("charset") || "utf8mb4",
    };
  }

  const map = {};
  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    map[key] = value;
  }

  const host = map.server || map.host || map.hostname || map.ip || "127.0.0.1";
  const user = map.uid || map.user || "root";
  const password = map.password ?? map.pwd ?? map.pass ?? "";
  const database = map.database || map.db || undefined;
  const port = Number(map.port || 3306);
  const charset = map.charset || "utf8mb4";

  return { host, port, user, password, database, charset };
}

function publicMysqlConfig(cfg, meta = {}) {
  return {
    host: cfg?.host || null,
    port: cfg?.port || null,
    user: cfg?.user || null,
    database: cfg?.database || null,
    charset: cfg?.charset || null,
    passwordSet: Boolean(cfg?.password),
    source: meta.source || null,
    root: meta.root || null,
  };
}

function mysqlConfig(overrides = {}) {
  const root = projectRoot(overrides);
  const resolved = resolveConnectionString(root);
  if (overrides.connectionString) {
    const cfg = parseConnectionString(overrides.connectionString);
    return {
      cfg,
      root,
      source: "override",
      raw: overrides.connectionString,
    };
  }
  if (!resolved.raw) {
    return { cfg: null, root, source: null, raw: null };
  }
  return {
    cfg: parseConnectionString(resolved.raw),
    root,
    source: resolved.source,
    raw: resolved.raw,
  };
}

function classifySql(sql) {
  const text = String(sql || "").trim();
  const destructive = DESTRUCTIVE_RE.test(text);
  const kind = destructive
    ? "destructive"
    : /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b/i.test(text)
      ? "read"
      : /^\s*(INSERT|UPDATE|REPLACE)\b/i.test(text)
        ? "write"
        : "other";
  return { destructive, kind };
}

function assertSafeIdentifier(name, label = "name") {
  const text = String(name || "").trim();
  if (!/^[a-zA-Z0-9_$.]+$/.test(text) || text.includes("..")) {
    throw new Error(`invalid ${label}: ${name}`);
  }
  return text;
}

function splitDbTable(tableName, defaultDb) {
  const raw = String(tableName || "").trim();
  if (!raw) throw new Error("table_name required");
  if (raw.includes(".")) {
    const [db, table] = raw.split(".", 2);
    return {
      database: assertSafeIdentifier(db, "database"),
      table: assertSafeIdentifier(table, "table"),
    };
  }
  return {
    database: defaultDb ? assertSafeIdentifier(defaultDb, "database") : null,
    table: assertSafeIdentifier(raw, "table"),
  };
}

async function withConnection(overrides, fn) {
  const { cfg, root, source } = mysqlConfig(overrides);
  if (!cfg) {
    return {
      ok: false,
      error:
        "MySQL connection not found — set mysql_connection_string in dev/dev.cfg (or server.cfg), or FXMIND_MYSQL_URL / .fxmind/mysql.json",
      config: publicMysqlConfig(null, { root, source }),
    };
  }
  const driver = getMysql2();
  const conn = await driver.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: cfg.charset,
    multipleStatements: false,
    connectTimeout: Number(process.env.FXMIND_MYSQL_TIMEOUT_MS || 8000),
  });
  try {
    const result = await fn(conn, cfg);
    return {
      ok: true,
      ...result,
      config: publicMysqlConfig(cfg, { root, source }),
    };
  } finally {
    await conn.end().catch(() => {});
  }
}

function status(overrides = {}) {
  const { cfg, root, source } = mysqlConfig(overrides);
  return {
    ok: true,
    configured: Boolean(cfg),
    config: publicMysqlConfig(cfg, { root, source }),
  };
}

/**
 * Execute one SQL statement.
 * Destructive ops need approvedByUser: true (after human approval).
 */
async function executeSql(query, options = {}) {
  const sql = String(query || "").trim();
  if (!sql) {
    return { ok: false, error: "empty query" };
  }
  if (sql.includes(";")) {
    const parts = sql.split(";").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      return { ok: false, error: "single statements only — no multi-statement SQL" };
    }
  }

  const { destructive, kind } = classifySql(sql);
  if (destructive && options.approvedByUser !== true) {
    return {
      ok: false,
      needsApproval: true,
      kind,
      error:
        "destructive SQL blocked (DELETE/DROP/TRUNCATE/…). Ask the user for approval, then retry with approvedByUser: true.",
      preview: sql.length > 500 ? `${sql.slice(0, 500)}…` : sql,
      config: publicMysqlConfig(mysqlConfig(options).cfg, {
        root: mysqlConfig(options).root,
        source: mysqlConfig(options).source,
      }),
    };
  }

  try {
    return await withConnection(options, async (conn) => {
      const [rows, fields] = await conn.query(sql);
      if (Array.isArray(rows)) {
        return {
          kind,
          approved: destructive ? true : undefined,
          rowCount: rows.length,
          columns: (fields || []).map((f) => f.name),
          rows: rows.slice(0, Number(options.limit) || 200),
          truncated: rows.length > (Number(options.limit) || 200),
        };
      }
      return {
        kind,
        approved: destructive ? true : undefined,
        affectedRows: rows.affectedRows,
        insertId: rows.insertId,
        changedRows: rows.changedRows,
        warningStatus: rows.warningStatus,
      };
    });
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      kind,
      config: publicMysqlConfig(mysqlConfig(options).cfg, {
        root: mysqlConfig(options).root,
        source: mysqlConfig(options).source,
      }),
    };
  }
}

async function getSchemaInfo(options = {}) {
  try {
    return await withConnection(options, async (conn, cfg) => {
      const tableName = options.table_name || options.tableName;
      if (!tableName) {
        const [tables] = await conn.query(
          `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine,
                  TABLE_ROWS AS approx_rows, TABLE_COMMENT AS comment
           FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME`,
          [cfg.database],
        );
        return { database: cfg.database, tables };
      }

      const { database, table } = splitDbTable(tableName, cfg.database);
      const db = database || cfg.database;
      const [columns] = await conn.query(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
                COLUMN_KEY AS \`key\`, COLUMN_DEFAULT AS \`default\`, EXTRA AS extra,
                COLUMN_COMMENT AS comment
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [db, table],
      );
      return { database: db, table, columns };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getTableSample(options = {}) {
  const tableName = options.table_name || options.tableName;
  if (!tableName) return { ok: false, error: "table_name required" };
  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 20);

  try {
    return await withConnection(options, async (conn, cfg) => {
      const { database, table } = splitDbTable(tableName, cfg.database);
      const db = database || cfg.database;
      const qualified = `\`${db}\`.\`${table}\``;
      const [rows, fields] = await conn.query(
        `SELECT * FROM ${qualified} LIMIT ?`,
        [limit],
      );
      return {
        database: db,
        table,
        rowCount: rows.length,
        columns: (fields || []).map((f) => f.name),
        rows,
      };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function exploreDatabase(options = {}) {
  try {
    return await withConnection(options, async (conn, cfg) => {
      const [tables] = await conn.query(
        `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine,
                TABLE_ROWS AS approx_rows, DATA_LENGTH AS data_length,
                INDEX_LENGTH AS index_length, TABLE_COMMENT AS comment
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [cfg.database],
      );
      const [dbRow] = await conn.query(`SELECT DATABASE() AS current_db, VERSION() AS version`);
      return {
        database: cfg.database,
        currentDb: dbRow[0]?.current_db,
        version: dbRow[0]?.version,
        tableCount: tables.length,
        tables,
      };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function analyzeTable(options = {}) {
  const tableName = options.table_name || options.tableName;
  if (!tableName) return { ok: false, error: "table_name required" };

  try {
    return await withConnection(options, async (conn, cfg) => {
      const { database, table } = splitDbTable(tableName, cfg.database);
      const db = database || cfg.database;
      const [statusRows] = await conn.query(`SHOW TABLE STATUS FROM \`${db}\` LIKE ?`, [
        table,
      ]);
      const [columns] = await conn.query(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
                COLUMN_KEY AS \`key\`, EXTRA AS extra
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [db, table],
      );
      const [indexes] = await conn.query(`SHOW INDEX FROM \`${db}\`.\`${table}\``);
      const [countRows] = await conn.query(
        `SELECT COUNT(*) AS exact_rows FROM \`${db}\`.\`${table}\``,
      );
      return {
        database: db,
        table,
        status: statusRows[0] || null,
        exactRows: countRows[0]?.exact_rows ?? null,
        columns,
        indexes,
      };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  CFG_CANDIDATES,
  DESTRUCTIVE_RE,
  projectRoot,
  parseConnectionString,
  readMysqlConnectionStringFromCfg,
  mysqlConfig,
  classifySql,
  status,
  executeSql,
  getSchemaInfo,
  getTableSample,
  exploreDatabase,
  analyzeTable,
  publicMysqlConfig,
};
