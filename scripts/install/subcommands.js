/**
 * install/subcommands — terminal sub-CLIs: corrections, fivem (RCON), db (MySQL), migrate.
 */
const fs = require("fs");
const path = require("path");

const fivemRcon = require("../fivem-rcon");
const fxmindMysql = require("../fxmind-mysql");
const { SHARED_DIR } = require("./config");
const { installAuditsDir, migrateAuditReports } = require("./legacy");

function runCorrectionsCli(argv = []) {
  const tools = require("../fxmind-tools");
  const sub = argv[0] || "list";
  const options = {
    target: process.cwd(),
    status: null,
    category: null,
    format: "md",
    title: null,
    bad: null,
    good: null,
    rule: null,
    notes: null,
    commit: null,
    severity: "high",
    help: false,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--target") options.target = path.resolve(argv[++i] || "");
    else if (arg === "--status") options.status = argv[++i] || null;
    else if (arg === "--category") options.category = argv[++i] || null;
    else if (arg === "--format") options.format = argv[++i] || "md";
    else if (arg === "--title") options.title = argv[++i] || "";
    else if (arg === "--bad") options.bad = argv[++i] || "";
    else if (arg === "--good") options.good = argv[++i] || "";
    else if (arg === "--rule") options.rule = argv[++i] || "";
    else if (arg === "--notes") options.notes = argv[++i] || "";
    else if (arg === "--commit") options.commit = argv[++i] || "";
    else if (arg === "--severity") options.severity = argv[++i] || "high";
    else if (!arg.startsWith("-") && (sub === "promote" || sub === "show")) {
      options.id = options.id || arg;
    }
  }

  if (options.help || sub === "-h" || sub === "--help") {
    console.log(`
fxmind corrections — skill-improvement backlog (separate from topic memories).

Usage:
  fxmind corrections list [--status open|promoted] [--category architecture|…]
  fxmind corrections add --title "…" --category style --bad "…" --good "…" [--rule "…"] [--commit sha]
  fxmind corrections export [--status open] [--format md|json]
  fxmind corrections promote <id>
  fxmind corrections show <id>

Categories: ${tools.CORRECTION_CATEGORIES.join(", ")}
`);
    return 0;
  }

  try {
    if (sub === "list") {
      const items = tools.listCorrections(options.target, {
        status: options.status || undefined,
        category: options.category || undefined,
      });
      console.log(`corrections → ${options.target} (${items.length})`);
      for (const item of items) {
        console.log(
          `  [${item.status}] ${item.id}  (${item.category})  ${item.title}`,
        );
      }
      return 0;
    }

    if (sub === "add") {
      if (!options.title || !options.bad || !options.good || !options.category) {
        console.error(
          "Error: add requires --title --category --bad --good",
        );
        return 1;
      }
      const result = tools.recordCorrection(options.target, options);
      console.log(`recorded → ${result.file}`);
      return 0;
    }

    if (sub === "export") {
      const result = tools.exportCorrections(options.target, {
        status: options.status || "open",
        category: options.category || null,
        format: options.format,
      });
      if (result.format === "json") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.markdown);
      }
      return 0;
    }

    if (sub === "promote") {
      if (!options.id) {
        console.error("Error: promote requires <id>");
        return 1;
      }
      const result = tools.promoteCorrection(options.target, options.id);
      console.log(`promoted → ${result.id} (${result.promoted_at})`);
      return 0;
    }

    if (sub === "show") {
      if (!options.id) {
        console.error("Error: show requires <id>");
        return 1;
      }
      const item = tools.listCorrections(options.target).find((c) => c.id === options.id);
      if (!item) {
        console.error(`Error: not found: ${options.id}`);
        return 1;
      }
      console.log(item.content);
      return 0;
    }

    console.error(`Unknown corrections subcommand: ${sub}`);
    return 1;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

function fivemAnsi(code, text) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function printFivemCmdResult(result, { json = false } = {}) {
  if (json || !result.ok) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const cmd = result.command || "ok";
  console.log(`${fivemAnsi("32", "✓")} ${fivemAnsi("1", cmd)}`);
  const body = String(result.response || result.note || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of body) {
    console.log(`  ${fivemAnsi("2", line)}`);
  }
}

async function runFivemCli(argv = []) {
  const options = { help: false, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      rest.push(arg);
    }
  }

  if (options.help || rest.length === 0) {
    console.log(`
fxmind fivem — local FXServer RCON (dev; no txAdmin).

  fxmind fivem install [--force] [--password <secret>]
  fxmind fivem status
  fxmind fivem ensure <resource>
  fxmind fivem stop <resource>
  fxmind fivem restart <resource>
  fxmind fivem start <resource>
  fxmind fivem refresh
  fxmind fivem cmd "ensure my_resource"
  fxmind fivem tail [--lines 80]

  --json   raw JSON output (default on errors)

  install  writes rcon_password to cfg + .vscode/fivem-start.ps1 tee + tasks.json
  ensure   UDP RCON reload
  tail     last lines of .fxmind/fivem-console.log (terminal mirror)

Env: FXMIND_RCON_HOST (127.0.0.1) FXMIND_RCON_PORT (30120)
     FXMIND_RCON_PASSWORD (optional if set in cfg by install)
`);
    return rest.length === 0 && !options.help ? 1 : 0;
  }

  const sub = rest[0];
  try {
    if (sub === "install") {
      let password;
      let force = false;
      for (let i = 1; i < rest.length; i += 1) {
        if (rest[i] === "--force" || rest[i] === "-f") {
          force = true;
        } else if (rest[i] === "--password" || rest[i] === "-p") {
          password = rest[i + 1];
          i += 1;
        }
      }
      const result = fivemRcon.installFivemDev({ force, password });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`${fivemAnsi("32", "✓")} ${fivemAnsi("1", "fivem install")}`);
        for (const step of result.steps || []) {
          const detail = [step.path, step.action].filter(Boolean).join(" · ");
          console.log(`  ${fivemAnsi("2", `${step.step}: ${detail}`)}`);
        }
        for (const w of result.warnings || []) {
          console.log(`  ${fivemAnsi("33", `⚠ ${w}`)}`);
        }
        if (result.note) {
          console.log(`  ${fivemAnsi("33", result.note)}`);
        }
      }
      return result.ok ? 0 : 1;
    }
    if (sub === "status") {
      console.log(JSON.stringify(fivemRcon.status(), null, 2));
      return 0;
    }
    if (sub === "tail") {
      let lines = 80;
      for (let i = 1; i < rest.length; i += 1) {
        if (rest[i] === "--lines" || rest[i] === "-n") {
          lines = Number(rest[i + 1] || 80);
          i += 1;
        }
      }
      const result = fivemRcon.consoleTail({ lines });
      if (!result.ok) {
        console.log(fivemAnsi("33", result.error || "sem entradas RCON"));
        return 0;
      }
      console.log(result.content);
      return 0;
    }
    if (sub === "cmd") {
      const command = rest.slice(1).join(" ");
      const result = await fivemRcon.execRcon(command);
      printFivemCmdResult(result, { json: options.json });
      return result.ok ? 0 : 1;
    }
    if (["ensure", "start", "stop", "restart", "refresh", "resmon"].includes(sub)) {
      const command = rest.join(" ");
      const result = await fivemRcon.execRcon(command);
      printFivemCmdResult(result, { json: options.json });
      return result.ok ? 0 : 1;
    }
    console.error(`Unknown fivem subcommand: ${sub}`);
    return 1;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

async function runDbCli(argv = []) {
  const options = { help: false, json: false, yes: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else rest.push(arg);
  }

  if (options.help || rest.length === 0) {
    console.log(`
fxmind db — MySQL via mysql_connection_string (dev/dev.cfg / oxmysql).

  fxmind db status
  fxmind db explore
  fxmind db schema [table]
  fxmind db sample <table> [--limit 5]
  fxmind db analyze <table>
  fxmind db query "SELECT ..." 
  fxmind db query "DELETE ..." --yes   # destructive needs --yes

  --json   raw JSON
`);
    return rest.length === 0 && !options.help ? 1 : 0;
  }

  const sub = rest[0];
  try {
    let result;
    if (sub === "status") result = fxmindMysql.status();
    else if (sub === "explore") result = await fxmindMysql.exploreDatabase();
    else if (sub === "schema") {
      result = await fxmindMysql.getSchemaInfo({ table_name: rest[1] });
    } else if (sub === "sample") {
      let limit = 5;
      for (let i = 2; i < rest.length; i += 1) {
        if (rest[i] === "--limit" || rest[i] === "-n") {
          limit = Number(rest[i + 1] || 5);
          i += 1;
        }
      }
      result = await fxmindMysql.getTableSample({ table_name: rest[1], limit });
    } else if (sub === "analyze") {
      result = await fxmindMysql.analyzeTable({ table_name: rest[1] });
    } else if (sub === "query") {
      const query = rest.slice(1).join(" ").replace(/^["']|["']$/g, "");
      result = await fxmindMysql.executeSql(query, { approvedByUser: options.yes });
    } else {
      console.error(`Unknown db subcommand: ${sub}`);
      return 1;
    }

    if (options.json || !result.ok) {
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }
    if (sub === "status") {
      console.log(
        `${fivemAnsi("32", "✓")} db ${result.configured ? "configured" : "missing"} · ${result.config?.source || "—"} · ${result.config?.database || "?"}@${result.config?.host || "?"}`,
      );
      return 0;
    }
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

function runMigrateCli(argv) {
  const options = { target: process.cwd(), help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--target") {
      options.target = path.resolve(argv[i + 1] || "");
      i += 1;
    }
  }

  if (options.help) {
    console.log(`
Migrate legacy .fxmind layout (e.g. audit-*.md at root → audits/).

Usage:
  fxmind migrate [--target <dir>]

Moves:
  .fxmind/audit-<resource>.md  →  .fxmind/audits/<resource>.md

Also ensures .fxmind/audits/ exists with README.
`);
    return 0;
  }

  if (!fs.existsSync(options.target)) {
    console.error(`Error: target directory does not exist: ${options.target}`);
    return 1;
  }

  const fxmindDir = path.join(options.target, SHARED_DIR);
  if (!fs.existsSync(fxmindDir)) {
    console.error(`Error: missing ${SHARED_DIR}/ — run fxmind -y first.`);
    return 1;
  }

  installAuditsDir(options.target);
  const migrated = migrateAuditReports(options.target);

  console.log(`\nMigrated: ${options.target}`);
  if (migrated.length === 0) {
    console.log("  (nothing to move — audits/ already clean)");
  } else {
    for (const dest of migrated) {
      console.log(`  ✓ → ${dest}`);
    }
  }
  console.log(`  ✓ audits/ ready\n`);
  return 0;
}

module.exports = {
  runCorrectionsCli,
  fivemAnsi,
  printFivemCmdResult,
  runFivemCli,
  runDbCli,
  runMigrateCli,
};
