---
description: "fxmind — FiveM project memory — task, judge, reference, audit, learn, memory health, graph, query, path, explain, update"
argument-hint: "task <implementation> | judge [target] | reference | audit [scope] | learn <topic> | memory health [fix] [topic] | graph | query \"<question>\" [--dfs] [--budget N] | path <a> <b> | explain <topic> | update | <question>"
---

# fxmind

**Input:** $ARGUMENTS

## Routing

Parse `$ARGUMENTS` (trim, case-insensitive). **Prefer Task for any code/config change** — also auto-runs from natural language (no slash command required when the Cursor auto-task rule / skill is installed). Each mode's full spec lives in **`.fxmind/modes/<mode>.md`** — read only the matched mode file before acting (keeps context lean).

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

**Task text:** when input starts with `task`, strip that keyword — the rest is the implementation request (e.g. `task desative garagem no admin_f` → goal = desative garagem no admin_f).

**Audit scope:** `audit` alone → resource from `@`/open files/ask; `audit resources/[Novos]/myresource` → that path; `audit server.lua` → file if exists.

## MCP fast path

If the fxmind MCP server is registered, prefer these tools over the manual mode specs — they run in Node (faster, cheaper, deterministic):

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

For Task mode, use **`fxmind_start_task`** then **`fxmind_record_gate`** for each gate (A → B → **V** → C) — never Write `.fxmind/fxmind-gates.json`. `fxmind_query` replaces the graph-router step (Gate B). For `graph`, `fxmind_graph` replaces the CLI shell-out.

## Shared memory (`.fxmind/`)

All agents read and write the **same project memory** under `.fxmind/` at the project root.

**Global store** (`fxmind --global-store -y`): memories and graph live in `~/.fxmind/projects/<id>/`; project `.fxmind/store.json` + symlinks keep agent paths unchanged. Pack skills install once to `~/.fxmind/shared/skills/`. Run `fxmind global list` to see registered projects. Graph/query may use **cross-project** memories when links exist.

| Path | Role |
|------|------|
| `.fxmind/memory/<topic>.md` | Shared topic memories (compact English, `lang: en-compact`) |
| `.fxmind/memory/_index.md` | Memory router |
| `.fxmind/modes/<mode>.md` | On-demand mode specs (read only the matched one) |
| `.fxmind/failure-modes.md` | Behavioral failure map (judge / Task self-audit) |
| `.fxmind/audit-procedure.md` | Heavy audit matrix (read only on `audit`) |
| `.fxmind/topic-catalog.md` | Learn search hints |
| `.fxmind/knowledge-graph.json` | Topic graph for query/path/explain |
| `.fxmind/audits/<resource>.md` | Audit reports |
| `.fxmind/*.template.md` | Report/memory skeletons (read-only) |

**Read policy:** always prefer `.fxmind/memory/` and `.fxmind/knowledge-graph.json`. If a topic exists only under a legacy per-agent folder (`.cursor/fivem/memory/`, `.gemini/fivem/memory/`, `.opencode/fivem/memory/`), read it as fallback and suggest re-running `fxmind -y` or `/fxmind memory health fix` to consolidate.

**Write policy:** `learn`, `memory health fix`, and `graph` write only to `.fxmind/` — never to per-agent memory folders. `audit` writes only to `.fxmind/audits/`.

## Skills layout

Only **`fxmind`** lives in the agent skills folder (`.cursor/skills/fxmind/`, `.gemini/skills/fxmind/`, etc.).

**Pack skills** (FiveM, frameworks, NUI) are installed by fxmind under **`.fxmind/skills/`** — read them on demand:

| Path | Role |
|------|------|
| `.fxmind/skills/_index.md` | Installed pack skills index |
| `.fxmind/skills/<name>/SKILL.md` | Domain skill (e.g. `fivem-development`, `vrp-framework`) |

**Never** look for pack skills in `.cursor/skills/`, `.gemini/skills/`, `.opencode/skills/`, etc.

## Mode file missing?

If `.fxmind/modes/<mode>.md` is missing, run `fxmind --update -y` (or `npx --yes github:fx-mind/fxmind --update -y`) to restore it, then retry. Do not improvise the mode from memory.
