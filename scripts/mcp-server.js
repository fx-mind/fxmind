#!/usr/bin/env node
/**
 * fxmind MCP server (stdio, JSON-RPC 2.0).
 *
 * Tools:
 *   fxmind_list_memories / fxmind_validate_memories / fxmind_query / fxmind_graph
 *   fxmind_drift_check / fxmind_start_task / fxmind_gate_status / fxmind_record_gate
 *   fxmind_record_correction / fxmind_list_corrections
 *   fxmind_fivem_install / fxmind_fivem_cmd / fxmind_fivem_console_tail / fxmind_fivem_status
 *   fxmind_db_status / fxmind_db_query / fxmind_db_schema / fxmind_db_sample
 *   fxmind_db_explore / fxmind_db_analyze
 *
 * Gates are session state — use fxmind_start_task + fxmind_record_gate only.
 * Never Write .fxmind/fxmind-gates.json from the agent.
 */

const tools = require("./fxmind-tools");
const fivemRcon = require("./fivem-rcon");
const fxmindMysql = require("./fxmind-mysql");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "fxmind", version: "1.4.0" };

function targetRoot() {
  return (
    process.env.FXMIND_TARGET ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
}

const TOOL_DEFS = [
  {
    name: "fxmind_list_memories",
    description:
      "List all fxmind topic memories under .fxmind/memory/ with frontmatter summary. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_validate_memories",
    description:
      "Validate memory frontmatter schema (required fields, paths/triggers, missing files). Also reports duplicate triggers/paths.",
    inputSchema: {
      type: "object",
      properties: {
        checkPaths: {
          type: "boolean",
          description: "Verify paths[] exist on disk (default true).",
          default: true,
        },
      },
    },
  },
  {
    name: "fxmind_query",
    description:
      "Traverse the knowledge graph for a question and load relevant memories within a token budget. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural-language question." },
        dfs: { type: "boolean", description: "DFS trace (default BFS).", default: false },
        budget: { type: "number", description: "Token budget (default 1500).", default: 1500 },
      },
      required: ["question"],
    },
  },
  {
    name: "fxmind_graph",
    description:
      "Rebuild knowledge-graph.json + HTML + memory-index.json from memories. Use after learn.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_drift_check",
    description:
      "Check which topic memories reference a changed file path (broken or stale-candidate).",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Changed file path (absolute or relative)." },
      },
      required: ["file"],
    },
  },
  {
    name: "fxmind_start_task",
    description:
      "Start a Task session (sets taskActive). Preferred over writing gates JSON. Call before Gate A. Pass trivial=true for one-file tiny edits to auto-complete Gates A and B.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Optional goal/scope note." },
        trivial: {
          type: "boolean",
          description:
            "If true, marks Gates A and B complete immediately (tiny one-file edits). Still requires Gate V before Gate C.",
        },
      },
    },
  },
  {
    name: "fxmind_gate_status",
    description: "Read Task Gate A/B/V/C session status. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_record_gate",
    description:
      "Persist a Gate marker (START, A, B, V, or C). Only way agents should update gates. Gate C clears taskActive.",
    inputSchema: {
      type: "object",
      properties: {
        gate: {
          type: "string",
          enum: ["START", "A", "B", "V", "C"],
          description:
            "START begins a task; A/B unlock edits; V records verify-by-observation; C closes the task.",
        },
        note: { type: "string", description: "Optional note (e.g. memories loaded)." },
      },
      required: ["gate"],
    },
  },
  {
    name: "fxmind_record_correction",
    description:
      "Save a human correction of an agent mistake into .fxmind/corrections/ (skill-improvement backlog — separate from topic memories).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title of the mistake." },
        category: {
          type: "string",
          enum: ["architecture", "communication", "security", "performance", "style", "api"],
          description: "Maps to best-practices skill area.",
        },
        bad: { type: "string", description: "What the agent did wrong (code/pattern)." },
        good: { type: "string", description: "Correct approach after human fix." },
        rule: { type: "string", description: "One-line rule to add to the skill." },
        notes: { type: "string" },
        commit: { type: "string", description: "Optional git commit SHA." },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        paths: { type: "array", items: { type: "string" } },
        resources: { type: "array", items: { type: "string" } },
        skill_target: { type: "string" },
      },
      required: ["title", "category", "bad", "good"],
    },
  },
  {
    name: "fxmind_list_corrections",
    description: "List skill-improvement corrections under .fxmind/corrections/. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "promoted", "dismissed"] },
        category: {
          type: "string",
          enum: ["architecture", "communication", "security", "performance", "style", "api"],
        },
      },
    },
  },
  {
    name: "fxmind_fivem_install",
    description:
      "Configure local FiveM RCON + Cursor fivem-start tee (idempotent). Writes rcon_password to cfg, .vscode/fivem-start.ps1, tasks.json, gitignore. Run once per project (or when RCON/status fails). After adding password, user must restart FXServer.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Overwrite .vscode/fivem-start.ps1 even if it already exists.",
        },
        password: {
          type: "string",
          description: "Optional local rcon_password (default fxmind-local-dev). Dev only.",
        },
      },
    },
  },
  {
    name: "fxmind_fivem_status",
    description:
      "Check local FiveM RCON config (host/port/password/log). Dev-only — FXServer via IDE task, no txAdmin. If passwordSet is false, call fxmind_fivem_install.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_fivem_cmd",
    description:
      "Send an allowlisted FXServer console command over local UDP RCON (ensure/start/stop/restart/refresh/status/resmon). After editing a resource, call this yourself — do not ask the user. If RCON is not configured, call fxmind_fivem_install first. Requires FXServer running with rcon_password loaded.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: 'e.g. "ensure my_resource", "restart vrp", "refresh"',
        },
      },
      required: ["command"],
    },
  },
  {
    name: "fxmind_fivem_console_tail",
    description:
      "Read the last N lines of .fxmind/fivem-console.log (FXServer stdout mirrored by the in-Cursor fivem-start.ps1 task). Full terminal output for live debug — not only the last ensure reply. Never ask the user to paste console output.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "Lines to return (default 80, max 500)." },
      },
    },
  },
  {
    name: "fxmind_db_status",
    description:
      "Check MySQL config from mysql_connection_string (dev/dev.cfg / server.cfg) or FXMIND_MYSQL_URL. Read-only; never returns the password.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_db_query",
    description:
      "Execute one SQL statement against the project MySQL (oxmysql connection from cfg). SELECT/SHOW/DESCRIBE and INSERT/UPDATE are allowed. DELETE/DROP/TRUNCATE (and ALTER…DROP) require approvedByUser=true AFTER explicit user approval (AskQuestion).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Single SQL statement." },
        approvedByUser: {
          type: "boolean",
          description:
            "Required true for DELETE/DROP/TRUNCATE after the user approved. Do not set true without asking.",
        },
        limit: {
          type: "number",
          description: "Max rows returned for SELECT (default 200).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fxmind_db_schema",
    description:
      "Get column metadata for a table, or list all tables if table_name is omitted. Like get_schema_info.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: {
          type: "string",
          description: "Optional bare table or database.table.",
        },
      },
    },
  },
  {
    name: "fxmind_db_sample",
    description:
      "Fetch a small sample of rows from a table (default 5, max 20). Like get_table_sample.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string" },
        limit: { type: "number" },
      },
      required: ["table_name"],
    },
  },
  {
    name: "fxmind_db_explore",
    description:
      "List tables in the configured database with approx row counts / engines. Like explore_database.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_db_analyze",
    description:
      "Analyze one table: status, exact COUNT(*), columns, indexes. Like analyze_table.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string" },
      },
      required: ["table_name"],
    },
  },
];

function dispatchTool(name, args) {
  const root = targetRoot();
  switch (name) {
    case "fxmind_list_memories":
      return { ok: true, memories: tools.listMemories(root) };

    case "fxmind_validate_memories": {
      const validation = tools.validateMemories(root, {
        checkPaths: args.checkPaths !== false,
      });
      return {
        ...validation,
        duplicates: tools.findMemoryDuplicates(root),
      };
    }

    case "fxmind_query":
      return tools.queryGraph(root, args.question || "", {
        dfs: Boolean(args.dfs),
        budget: Number(args.budget) || 1500,
      });

    case "fxmind_graph":
      return tools.buildGraph(root);

    case "fxmind_drift_check":
      return tools.driftCheck(root, args.file || "");

    case "fxmind_start_task":
      return {
        ok: true,
        ...tools.startTask(root, {
          note: args.note || "",
          trivial: Boolean(args.trivial),
        }),
      };

    case "fxmind_gate_status":
      return tools.gateStatus(root);

    case "fxmind_record_gate":
      return {
        ok: true,
        ...tools.recordGate(root, String(args.gate).toUpperCase(), true, {
          note: args.note || "",
        }),
      };

    case "fxmind_record_correction":
      return tools.recordCorrection(root, {
        title: args.title,
        category: args.category,
        bad: args.bad,
        good: args.good,
        rule: args.rule,
        notes: args.notes,
        commit: args.commit,
        severity: args.severity,
        paths: args.paths,
        resources: args.resources,
        skill_target: args.skill_target,
      });

    case "fxmind_list_corrections":
      return {
        ok: true,
        corrections: tools.listCorrections(root, {
          status: args.status || undefined,
          category: args.category || undefined,
        }),
      };

    case "fxmind_fivem_install":
      return fivemRcon.installFivemDev({
        force: Boolean(args.force),
        password: args.password || undefined,
      });

    case "fxmind_fivem_status":
      return fivemRcon.status();

    case "fxmind_fivem_cmd":
      return fivemRcon.execRcon(args.command || "");

    case "fxmind_fivem_console_tail":
      return fivemRcon.consoleTail({ lines: args.lines });

    case "fxmind_db_status":
      return fxmindMysql.status();

    case "fxmind_db_query":
      return fxmindMysql.executeSql(args.query || "", {
        approvedByUser: Boolean(args.approvedByUser),
        limit: args.limit,
      });

    case "fxmind_db_schema":
      return fxmindMysql.getSchemaInfo({ table_name: args.table_name });

    case "fxmind_db_sample":
      return fxmindMysql.getTableSample({
        table_name: args.table_name,
        limit: args.limit,
      });

    case "fxmind_db_explore":
      return fxmindMysql.exploreDatabase();

    case "fxmind_db_analyze":
      return fxmindMysql.analyzeTable({ table_name: args.table_name });

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0") {
    return;
  }
  const id = msg.id;
  const method = msg.method;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: { tools: TOOL_DEFS },
    });
    return;
  }

  if (method === "tools/call") {
    const toolName = msg.params?.name;
    const args = msg.params?.arguments || {};
    Promise.resolve()
      .then(() => dispatchTool(toolName, args))
      .then((result) => {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: result && result.ok === false,
          },
        });
      })
      .catch((error) => {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          },
        });
      });
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }
});

process.stdin.on("end", () => process.exit(0));
