---
name: fxmind
description: "fxmind — FiveM project memory — task, judge, reference, audit, learn, memory health, graph, query, path, explain, update"
argument-hint: "task <implementation> | judge [target] | reference | audit [scope] | learn <topic> | memory health [fix] [topic] | graph | query \"<question>\" [--dfs] [--budget N] | path <a> <b> | explain <topic> | update | <question>"
agent: agent
tools: ["fxmind/*"]
---

# fxmind

**Input:** the user's text after `/fxmind` in chat (trim, case-insensitive).

## Routing

Parse the input. **Prefer Task for any code/config change** — the `.github/skills/fxmind/SKILL.md` skill also auto-runs Task from natural language. Each mode's full spec lives in **`.fxmind/modes/<mode>.md`** — read only the matched mode file before acting (keeps context lean).

| Input | Mode file |
|-------|-----------|
| `task` or `task ...` | `.fxmind/modes/task.md` (**preferred** for code/config changes) |
| `judge` or `judge ...` | `.fxmind/modes/judge.md` (claims vs observation; after Task / any "done") |
| `reference` or `reference ...` | `.fxmind/modes/reference.md` |
| `audit` or `audit ...` | `.fxmind/modes/audit.md` |
| `learn` or `learn <topic>` / `learn list` | `.fxmind/modes/learn.md` |
| `memory health [fix] [topic]` | `.fxmind/modes/memory-health.md` |
| `graph` | `.fxmind/modes/graph.md` — **just run `fxmind graph`** |
| `query "<question>"` [--dfs] [--budget N] | `.fxmind/modes/query.md` |
| `path <topic-a> <topic-b>` | `.fxmind/modes/path.md` |
| `explain <topic>` | `.fxmind/modes/explain.md` |
| `update` | `.fxmind/modes/update.md` |
| implementation request without `task` | `task.md` — same as Task (auto) |
| empty or conceptual question | `.fxmind/modes/help.md` |

**Task text:** when input starts with `task`, strip that keyword — the rest is the implementation request.

**Audit scope:** `audit` alone → resource from `@`/open files/ask; `audit resources/[Novos]/myresource` → that path; `audit server.lua` → file if exists.

## MCP fast path

If the fxmind MCP server is registered in `.vscode/mcp.json`, prefer its tools over manual mode specs:

| Operation | MCP tool |
|-----------|----------|
| List memories | `fxmind_list_memories` |
| Validate memories | `fxmind_validate_memories` |
| Query graph (BFS/DFS, budget-aware) | `fxmind_query` |
| Rebuild graph + memory-index | `fxmind_graph` |
| Drift check for a file | `fxmind_drift_check` |
| Start Task session | `fxmind_start_task` |
| Read Gate A/B/V/C status | `fxmind_gate_status` |
| Record a Gate marker (START/A/B/V/C) | `fxmind_record_gate` |

For Task mode, use **`fxmind_start_task`** then **`fxmind_record_gate`** for each gate (A → B → **V** → C) — never Write `.fxmind/fxmind-gates.json`.

## Shared memory (`.fxmind/`)

All agents read and write the **same project memory** under `.fxmind/` at the project root.

| Path | Role |
|------|------|
| `.fxmind/memory/<topic>.md` | Shared topic memories |
| `.fxmind/modes/<mode>.md` | On-demand mode specs |
| `.fxmind/skills/<name>/SKILL.md` | Pack skills (FiveM, frameworks, NUI) |

**Pack skills** live under **`.fxmind/skills/`** — not in `.github/skills/` (that folder is only for the fxmind agent skill).

## Mode file missing?

Run `fxmind --update -y` to restore templates, then retry.
