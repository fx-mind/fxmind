/**
 * Build compact .fxmind context for CLI prompts (index + query hits).
 */

const fs = require("fs");
const path = require("path");
const tools = require("../fxmind-tools");

const FXMIND_TOOLS_MANDATE = [
  "## Ferramentas FxMind (obrigatório — entrega rápida)",
  "",
  "Este projeto é otimizado para **ferramentas MCP fxmind** (Node, pré-indexadas). Use-as em **todo** o pipeline — não substitua por grep, find ou shell search.",
  "",
  "| Fase | Ferramentas MCP |",
  "|------|-----------------|",
  "| Descoberta / Gate B | `fxmind_query`, `fxmind_list_memories` (ou memórias pré-carregadas abaixo) |",
  "| Grafo | `fxmind_graph` `{ updateHtml: false }` |",
  "| Task / Gates | `fxmind_start_task`, `fxmind_record_gate`, `fxmind_gate_status` |",
  "| Arquivo alterado | `fxmind_drift_check` |",
  "| FiveM dev | `fxmind_fivem_status` → `fxmind_fivem_cmd` / `fxmind_fivem_console_tail` / `fxmind_fivem_nui_*` |",
  "| MySQL | `fxmind_db_schema`, `fxmind_db_sample`, `fxmind_db_query` |",
  "| Correções | `fxmind_record_correction`, `fxmind_list_corrections` |",
  "| Subagentes (qualquer CLI) | `fxmind_subagent_run { agent: explore\\|reader\\|general\\|scout, prompt, paths? }` |",
  "",
  "**Proibido** para descoberta: grep/rg/find/Select-String/bash em todo o repo. Read só em paths vindos de fxmind_query/memórias.",
  "",
  "Sem MCP **fxmind** visível → **PARE** e peça habilitar (`fxmind hooks install`). Não improvise com busca manual.",
].join("\n");

const QUICK_MODE_BLOCK = [
  "## Panel execution mode",
  "",
  "PANEL_MODE: quick",
  "",
  "When PANEL_MODE is quick:",
  "- Call fxmind_start_task with trivial: true (auto-completes Gates A and B)",
  "- Skip QUALITY blocks, multi-round Gate B lookups, and Judge unless the user asks for proof or the diff touches 3+ files",
  "- Gate V: Done criterion + twins if bugfix; FiveM ensure/tail only when fxmind_fivem_status.available",
  "- Gate C: \"mudança pontual\" unless clearly reusable knowledge",
  "- Trust preloaded graph hits; `fxmind_query` only if none match",
  "- All gates and verify via fxmind MCP tools only",
  "- No grep, no subagents for discovery",
].join("\n");

const FULL_MODE_BLOCK = [
  "## Panel execution mode",
  "",
  "PANEL_MODE: full",
  "",
  "When PANEL_MODE is full:",
  "- Gate B: **fxmind_query** + fxmind MCP only — then Read paths from results",
  "- OpenCode: native **reader**/**explore** subagents when configured; otherwise (or for a subagent on a different provider) use `fxmind_subagent_run` — **reader** with paths from query, **explore** only after fxmind_query still lacks paths",
  "- Subagents (native or via fxmind_subagent_run) must use fxmind MCP too; they must not call fxmind_start_task, fxmind_record_gate, or Judge",
  "- No repo-wide grep/rg/bash — FxMind tools are the fast path",
].join("\n");

const PLAN_MODE_BLOCK = [
  "## Panel execution mode",
  "",
  "OPERATION_MODE: plan",
  "",
  "When OPERATION_MODE is plan:",
  "- Produce a structured plan (steps, files/areas to touch, risks, open questions) and then STOP",
  "- Do NOT edit, create, or delete any file — this run is read-only regardless of the panel's access mode",
  "- Do NOT call fxmind_start_task, fxmind_record_gate, or any other write/apply tool",
  "- If the request is ambiguous, ask a clarifying question instead of guessing",
  "- End the reply with a clear, numbered list of next steps the user can approve before any code changes",
].join("\n");

const QUERY_MODE_BLOCK = [
  "## Panel execution mode",
  "",
  "OPERATION_MODE: query",
  "",
  "When OPERATION_MODE is query:",
  "- The user is asking a question, not requesting a code change — answer it directly and conversationally",
  "- This run is READ-ONLY regardless of the panel's access mode — do NOT edit, create, or delete any file",
  "- Do NOT call fxmind_start_task, fxmind_record_gate, or any other write/apply tool",
  "- The \"Relevant memories (graph query)\" section below is a starting point, not a guaranteed answer — the graph does not always cover what was asked",
  "- If those memories don't fully answer the question, call fxmind_query again with different terms, or Read specific files, before answering",
  "- Reply with the answer itself — do not produce a plan and do not start implementing anything",
].join("\n");

function readIndex(root) {
  const indexPath = path.join(root, ".fxmind", "memory", "_index.md");
  if (!fs.existsSync(indexPath)) return "";
  try {
    return fs.readFileSync(indexPath, "utf8").slice(0, 4000);
  } catch {
    return "";
  }
}

function normalizeTaskMode(value) {
  return value === "quick" ? "quick" : "full";
}

function panelModeBlock(taskMode) {
  return normalizeTaskMode(taskMode) === "quick" ? QUICK_MODE_BLOCK : FULL_MODE_BLOCK;
}

/**
 * Operation mode is orthogonal to taskMode (quick/full, which only tunes gate
 * verbosity within a real execution): task runs the agent normally, plan asks
 * it to stop after producing a plan (no file edits), query asks it to answer
 * a question read-only using the graph-query hits below as a starting point
 * (not a guaranteed answer — see QUERY_MODE_BLOCK). All three always reach
 * this file; the server still forces accessMode="ask" for plan and query
 * regardless of the panel's saved preference (see panel-cli.js:runThreadDirect).
 * Anything else falls back to "task".
 */
function normalizeOperationMode(value) {
  return value === "plan" || value === "query" ? value : "task";
}

function buildContextFile(root, userPrompt, options = {}) {
  const budget = Number(options.budget) || 1200;
  const taskMode = normalizeTaskMode(options.taskMode);
  const operationMode = normalizeOperationMode(options.mode);
  const modeBlock =
    operationMode === "plan"
      ? PLAN_MODE_BLOCK
      : operationMode === "query"
        ? QUERY_MODE_BLOCK
        : panelModeBlock(taskMode);
  const lines = [
    "# FxMind project context",
    "",
    `Workspace: ${root}`,
    "",
    modeBlock,
    "",
    FXMIND_TOOLS_MANDATE,
    "",
  ];

  const memories = tools.listMemories(root);
  lines.push(`Memories on disk: ${memories.length}`);
  const index = readIndex(root);
  if (index) {
    lines.push("", "## memory/_index.md", index);
  }

  const question = String(userPrompt || "").trim();
  if (question) {
    lines.push("", "## Latest user request", question);
    const query = tools.queryGraph(root, question, {
      budget,
      updateHtml: false,
      rebuild: false,
    });
    if (query.graphStale) {
      lines.push("", "GRAPH: stale (using last built graph; background rebuild may run)");
    }
    if (query.ok && Array.isArray(query.memories) && query.memories.length) {
      lines.push("", "## Relevant memories (graph query)");
      for (const mem of query.memories) {
        lines.push("", `### ${mem.topic || mem.slug}`);
        if (mem.content) lines.push(String(mem.content).slice(0, 2000));
      }
    } else if (query.ok && query.note) {
      lines.push("", `## Graph query note`, String(query.note));
    }
  }

  return lines.join("\n");
}

const JUDGE_MODE_BLOCK = [
  "## Cross-provider judge",
  "",
  "You are reviewing another AI agent's completed work on this repository — you did NOT write this diff.",
  "",
  "1. Read the diff summary and the executing agent's final report below.",
  "2. Verify claims against the actual diff — do not trust the report blindly.",
  "3. Look for: incomplete implementation, untested claims, scope creep, obvious bugs, missing edge cases.",
  "4. This run is READ-ONLY — do not edit, create, or delete any file, do not run fxmind_start_task/fxmind_record_gate.",
  "",
  "End your reply with exactly one line, verbatim, starting with one of:",
  "VERDICT: VERIFIED",
  "VERDICT: VERIFIED WITH CAVEATS",
  "VERDICT: REFUTED",
  "followed by a one-paragraph summary of why.",
].join("\n");

/**
 * Context for a judge run: a different provider reviewing the primary run's
 * diff/output on the same thread. Deliberately separate from
 * buildContextFile — the judge never sees fxmind MCP tool instructions since
 * it must not call fxmind_start_task/fxmind_record_gate.
 */
function buildJudgeContextFile(root, threadId, options = {}) {
  const lines = [
    "# FxMind cross-provider judge context",
    "",
    `Workspace: ${root}`,
    "",
    JUDGE_MODE_BLOCK,
    "",
    "## Original user request",
    String(options.userPrompt || "(none)").slice(0, 4000),
    "",
    "## Executing agent's final report",
    String(options.primaryOutput || "(no report)").slice(0, 6000),
  ];
  if (options.diff) {
    lines.push("", "## Diff summary", String(options.diff).slice(0, 6000));
  }
  const file = path.join(require("os").tmpdir(), `fxmind-judge-${threadId}.md`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function writeContextTemp(root, userPrompt, threadId, options = {}) {
  const body = buildContextFile(root, userPrompt, options);
  const imagePaths = Array.isArray(options.imagePaths) ? options.imagePaths : [];
  const lines = [body];
  if (imagePaths.length) {
    lines.push("", "## Attached images");
    for (const img of imagePaths) {
      lines.push(`- ${img.name} (${img.mimeType}): ${img.path}`);
    }
  }
  const file = path.join(require("os").tmpdir(), `fxmind-ctx-${threadId}.md`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

module.exports = {
  buildContextFile,
  buildJudgeContextFile,
  writeContextTemp,
  readIndex,
  normalizeTaskMode,
  normalizeOperationMode,
  panelModeBlock,
};
