#!/usr/bin/env node
/**
 * fxmind MCP server (stdio, JSON-RPC 2.0).
 *
 * Exposes fxmind knowledge/memory operations as MCP tools so any agent that
 * speaks MCP can call them programmatically instead of parsing markdown.
 *
 * Tools:
 *   fxmind_list_memories   — list topic memories + frontmatter
 *   fxmind_query           — BFS/DFS graph traversal, budget-aware memory load
 *   fxmind_graph           — rebuild .fxmind/knowledge-graph.json + HTML
 *   fxmind_drift_check     — memories referencing a changed file (stale/broken)
 *   fxmind_gate_status     — read Gate A/B/C markers recorded by hooks/`/fxmind task`
 *   fxmind_record_gate     — persist a Gate marker
 *
 * Run:
 *   node scripts/mcp-server.js            # target = cwd
 *   FXMIND_TARGET=/path node scripts/mcp-server.js
 *
 * Wire into an MCP client with command `node <path-to>/scripts/mcp-server.js`.
 */

const tools = require("./fxmind-tools");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "fxmind", version: "1.0.0" };

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
      "List all fxmind topic memories under .fxmind/memory/ with frontmatter summary (paths, events, exports, triggers). Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_query",
    description:
      "Traverse the fxmind topic knowledge graph for a question and load relevant memories within a token budget. Read-only.",
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
    description: "Rebuild .fxmind/knowledge-graph.json + HTML from memories. Use after /fxmind learn.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_drift_check",
    description:
      "Check which topic memories reference a changed file path. Returns broken (file gone) or stale-candidate (file exists, memory may need re-learn).",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Changed file path (absolute or relative to project root)." },
      },
      required: ["file"],
    },
  },
  {
    name: "fxmind_gate_status",
    description: "Read fxmind Task-mode Gate A/B/C markers from .fxmind/fxmind-gates.json.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_record_gate",
    description: "Persist a fxmind Task-mode Gate marker (A, B, or C). Used by /fxmind task and hooks.",
    inputSchema: {
      type: "object",
      properties: {
        gate: { type: "string", enum: ["A", "B", "C"], description: "Gate letter." },
        note: { type: "string", description: "Optional note (e.g. memories loaded)." },
      },
      required: ["gate"],
    },
  },
];

function dispatchTool(name, args) {
  switch (name) {
    case "fxmind_list_memories":
      return { ok: true, memories: tools.listMemories(targetRoot()) };

    case "fxmind_query": {
      const result = tools.queryGraph(targetRoot(), args.question || "", {
        dfs: Boolean(args.dfs),
        budget: Number(args.budget) || 1500,
      });
      return result;
    }

    case "fxmind_graph":
      return tools.buildGraph(targetRoot());

    case "fxmind_drift_check":
      return tools.driftCheck(targetRoot(), args.file || "");

    case "fxmind_gate_status":
      return tools.gateStatus(targetRoot());

    case "fxmind_record_gate":
      return tools.recordGate(targetRoot(), String(args.gate).toUpperCase(), true, {
        note: args.note || "",
      });

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
    } catch (error) {
      // ignore malformed lines
    }
  }
});

process.stdin.on("end", () => process.exit(0));

if (require.main === module && !process.stdin.isTTY) {
  // running as stdio server — nothing else to do
}
