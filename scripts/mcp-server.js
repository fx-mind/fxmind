#!/usr/bin/env node
/**
 * fxmind MCP server (stdio, JSON-RPC 2.0).
 *
 * Tools:
 *   fxmind_list_memories / fxmind_validate_memories / fxmind_query / fxmind_graph
 *   fxmind_drift_check / fxmind_start_task / fxmind_gate_status / fxmind_record_gate
 *
 * Gates are session state — use fxmind_start_task + fxmind_record_gate only.
 * Never Write .fxmind/fxmind-gates.json from the agent.
 */

const tools = require("./fxmind-tools");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "fxmind", version: "1.2.0" };

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
      "Start a Task session (sets taskActive). Preferred over writing gates JSON. Call before Gate A.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Optional goal/scope note." },
      },
    },
  },
  {
    name: "fxmind_gate_status",
    description: "Read Task Gate A/B/C session status. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_record_gate",
    description:
      "Persist a Gate marker (START, A, B, or C). Only way agents should update gates. Gate C clears taskActive.",
    inputSchema: {
      type: "object",
      properties: {
        gate: {
          type: "string",
          enum: ["START", "A", "B", "C"],
          description: "START begins a task; A/B unlock edits; C closes the task.",
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
      return { ok: true, ...tools.startTask(root, { note: args.note || "" }) };

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
    try {
      const result = dispatchTool(toolName, args);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: result && result.ok === false,
        },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        },
      });
    }
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
