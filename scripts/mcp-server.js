#!/usr/bin/env node
/**
 * fxmind MCP server (stdio, JSON-RPC 2.0).
 *
 * Tools:
 *   fxmind_list_memories / fxmind_validate_memories / fxmind_query / fxmind_graph / fxmind_check_update
 *   fxmind_drift_check / fxmind_start_task / fxmind_gate_status / fxmind_record_gate
 *   fxmind_record_correction / fxmind_list_corrections
 *   fxmind_fivem_install / fxmind_fivem_cmd / fxmind_fivem_console_tail / fxmind_fivem_status
 *   fxmind_fivem_nui_wire / fxmind_fivem_nui_dump / fxmind_fivem_nui_unwire
 *   fxmind_db_status / fxmind_db_query / fxmind_db_schema / fxmind_db_sample
 *   fxmind_db_explore / fxmind_db_analyze
 *   fxmind_panel_wait / fxmind_panel_pending / fxmind_panel_reply / fxmind_panel_fail
 *   fxmind_subagent_run
 *
 * Gates are session state — use fxmind_start_task + fxmind_record_gate only.
 * Never Write .fxmind/state/fxmind-gates.json from the agent.
 */

const tools = require("./fxmind-tools");
const fivemRcon = require("./fivem-rcon");
const fivemNuiDump = require("./fivem-nui-dump");
const fxmindMysql = require("./fxmind-mysql");
const { checkForUpdate } = require("./lib/update-check");
const panelHost = require("./lib/panel-host");

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
      "Rebuild .fxmind/graph/knowledge-graph.json + memory-index.json from memories (HTML optional). Use after learn.",
    inputSchema: {
      type: "object",
      properties: {
        updateHtml: {
          type: "boolean",
          description:
            "Also sync knowledge-graph.html (default true). Set false for JSON + index only.",
          default: true,
        },
      },
    },
  },
  {
    name: "fxmind_check_update",
    description:
      "Check whether a newer fxmind version or project layout is available on GitHub. Read-only — does not run update.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Bypass 24h throttle and re-fetch remote version (default false).",
          default: false,
        },
      },
    },
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
      "Dev-only: configure local FiveM RCON + Cursor fivem-start task. Writes rcon_password only to dev/dev.cfg and .fxmind/state/rcon.json (never server.cfg). Run once per project before fxmind_fivem_cmd. After adding password, user must restart FXServer.",
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
      "Check local FiveM RCON install marker and probe FXServer (UDP status). available:true only when fxmind fivem install was run AND the console responds. Call BEFORE fxmind_fivem_cmd or fxmind_fivem_console_tail. installed:false → fxmind_fivem_install once. configured but serverReachable:false → ask user to start fivem-start; do not call cmd/tail.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_fivem_cmd",
    description:
      "Send allowlisted FXServer console command over local UDP RCON. Requires fxmind fivem install. Call fxmind_fivem_status first — only when available:true. Never auto-runs install. If install missing or console not running, returns an error (do not claim success).",
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
      "Read .fxmind/state/fivem-console.log and optional server-debug.log. Requires fxmind fivem install (.fxmind/state/rcon.json). Call fxmind_fivem_status first when possible. Never auto-runs install.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "Lines to return (default 80, max 500)." },
      },
    },
  },
  {
    name: "fxmind_fivem_nui_wire",
    description:
      "TEMP agent setup: patch a NUI resource (fxmanifest client-hook + DOM probe in ui_page) so fxmind_fivem_nui_dump works. You configure this yourself — do not ask the user to edit scripts. ALWAYS call fxmind_fivem_nui_unwire when finished (or before Gate C). Ensures fxmind-nui-bridge is present.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description: "Resource folder name that owns the ui_page (e.g. my_police).",
        },
      },
      required: ["resource"],
    },
  },
  {
    name: "fxmind_fivem_nui_dump",
    description:
      "Read structured NUI state for agent vision (better than screenshots). Prefer after fxmind_fivem_nui_wire. Triggers RCON fxmind_nui_dump (unless trigger=false), then reads .fxmind/state/nui-dump.json. Call fxmind_fivem_status first when triggering. Player must be in-game with the NUI open. After debugging, call fxmind_fivem_nui_unwire.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description: "Optional resource name filter (only that NUI responds).",
        },
        trigger: {
          type: "boolean",
          description: "Request a fresh dump via RCON (default true). Set false to only read the last file.",
          default: true,
        },
        timeoutMs: {
          type: "number",
          description: "How long to wait for the dump file after trigger (default 3000, max 15000).",
        },
      },
    },
  },
  {
    name: "fxmind_fivem_nui_unwire",
    description:
      "Remove temporary NUI dump wiring added by fxmind_fivem_nui_wire (markers, probe script, wire state, dump file). MANDATORY cleanup after using nui_dump / when the task ends. If resource omitted, uses .fxmind/state/nui-wire.json.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description: "Optional; defaults to the currently wired resource.",
        },
        clearDump: {
          type: "boolean",
          description: "Also delete .fxmind/state/nui-dump.json (default true).",
          default: true,
        },
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
  {
    name: "fxmind_panel_wait",
    description:
      "Host-chat dispatcher for /fxmind painel. Long-poll the local panel (localhost:3847) until demandas are clicked, then claim them. Returns { jobs: [{ id, title, prompt, projectRoot }] }. Empty jobs = keep waiting. Do not use an API key.",
    inputSchema: {
      type: "object",
      properties: {
        timeoutMs: {
          type: "number",
          description: "Wait up to this many ms (default 20000, max 25000).",
          default: 20000,
        },
      },
    },
  },
  {
    name: "fxmind_panel_pending",
    description:
      "List queued panel chat jobs without claiming them. Also heartbeats so the panel shows this chat as connected.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_panel_reply",
    description:
      "Post the host agent result into a panel thread after finishing a demanda (or follow-up).",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Panel thread id (job.id)." },
        content: { type: "string", description: "Assistant reply shown in the panel chat." },
      },
      required: ["threadId", "content"],
    },
  },
  {
    name: "fxmind_panel_fail",
    description: "Mark a panel thread as failed with an error message.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        error: { type: "string" },
      },
      required: ["threadId", "error"],
    },
  },
  {
    name: "fxmind_subagent_run",
    description:
      "Delegates a scoped sub-task to a fxmind subagent (explore, reader, general, or scout) and blocks until it returns final text. Works from ANY CLI (OpenCode, Codex, Claude Code, Cursor Agent, Hermes) and the subagent itself may run on a DIFFERENT provider than the one calling this tool — whichever is configured per subagent in the panel's Settings → Subagentes (defaults to the best installed provider). Use 'explore' for broad read-only discovery, 'reader' when you already know the exact paths, 'general' for a narrowly-scoped bounded edit/command, 'scout' for external docs/APIs outside this repo. Prefer this over doing the sub-task inline when a specialized or cheaper model is configured for that role.",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Subagent id: explore | reader | general | scout.",
        },
        prompt: { type: "string", description: "The scoped task/question for the subagent." },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Known file paths to hand over (mainly for 'reader').",
        },
      },
      required: ["agent", "prompt"],
    },
  },
];

let activeHostThreadId = null;

function hostToolDetail(args = {}) {
  const value =
    args.question ||
    args.query ||
    args.file ||
    args.table_name ||
    args.gate ||
    args.resource ||
    args.note ||
    args.command ||
    "";
  if (typeof value === "string") return value.slice(0, 240);
  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return "";
  }
}

function reportHostMcp(threadId, toolName, args, status) {
  const name = String(toolName || "");
  if (!threadId || !name || name.startsWith("fxmind_panel_")) {
    return Promise.resolve();
  }
  return panelHost
    .activity(threadId, {
      kind: "mcp",
      name,
      server: SERVER_INFO.name,
      label: name,
      detail: hostToolDetail(args),
      status,
    })
    .catch(() => {});
}

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
      return tools.buildGraph(root, {
        updateHtml: args.updateHtml !== false,
      });

    case "fxmind_check_update":
      return checkForUpdate({
        projectRoot: root,
        force: Boolean(args.force),
      });

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
      return fivemRcon.statusProbe();

    case "fxmind_fivem_cmd":
      return fivemRcon.execRcon(args.command || "");

    case "fxmind_fivem_console_tail":
      return fivemRcon.consoleTail({ lines: args.lines });

    case "fxmind_fivem_nui_wire":
      return fivemNuiDump.wireNuiDump({
        resource: args.resource || "",
      });

    case "fxmind_fivem_nui_dump":
      return fivemNuiDump.nuiDump({
        resource: args.resource || undefined,
        trigger: args.trigger !== false,
        timeoutMs: args.timeoutMs,
      });

    case "fxmind_fivem_nui_unwire":
      return fivemNuiDump.unwireNuiDump({
        resource: args.resource || undefined,
        clearDump: args.clearDump !== false,
      });

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

    case "fxmind_panel_wait":
      return panelHost.wait(args.timeoutMs);

    case "fxmind_panel_pending":
      return panelHost.pending();

    case "fxmind_panel_reply":
      return panelHost.reply(args.threadId, args.content);

    case "fxmind_panel_fail":
      return panelHost.fail(args.threadId, args.error);

    case "fxmind_subagent_run": {
      // Lazy require: panel-cli.js pulls in the panel's thread store on
      // load, which every agent session spinning up this stdio server
      // shouldn't pay for unless a subagent is actually invoked.
      const panelCli = require("./lib/panel-cli");
      return panelCli.runSubagentTask(root, {
        agent: args.agent,
        prompt: args.prompt || "",
        paths: Array.isArray(args.paths) ? args.paths : [],
      });
    }

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
    const isPanelTool = String(toolName || "").startsWith("fxmind_panel_");
    const trackedThreadId = isPanelTool ? null : activeHostThreadId;
    Promise.resolve()
      .then(() => reportHostMcp(trackedThreadId, toolName, args, "running"))
      .then(() => dispatchTool(toolName, args))
      .then((result) => {
        if (toolName === "fxmind_panel_wait" && result?.jobs?.length) {
          activeHostThreadId = String(result.jobs[0].id || "");
        }
        if (
          toolName === "fxmind_panel_reply" ||
          toolName === "fxmind_panel_fail"
        ) {
          activeHostThreadId = null;
        }
        const status = result && result.ok === false ? "error" : "done";
        return reportHostMcp(trackedThreadId, toolName, args, status).then(() => {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: result && result.ok === false,
            },
          });
        });
      })
      .catch((error) => {
        return reportHostMcp(trackedThreadId, toolName, args, "error").then(() => {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Error: ${error.message}` }],
              isError: true,
            },
          });
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

function startServer() {
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
}

if (require.main === module) {
  startServer();
}

module.exports = {
  SERVER_INFO,
  TOOL_DEFS,
};
