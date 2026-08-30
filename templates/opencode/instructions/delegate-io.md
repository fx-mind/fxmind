# Orchestration (OpenCode + fxmind)

**FxMind MCP tools are mandatory** for discovery, gates, graph, FiveM, and DB — they are optimized for fast delivery. You keep architecture, intent, gates, and the answer to the user.

If Read / Glob / Grep / List are **denied** on this agent, use **fxmind MCP** and **reader** subagent — not repo-wide grep.

## Must use (in order)

| Need | Who | How |
|------|-----|-----|
| Gate B / "where is X" | **you** | **`fxmind_query`** + preloaded context file — **never** grep |
| Gates / task | **you** | `fxmind_start_task`, `fxmind_record_gate`, `fxmind_gate_status` |
| Read known path(s) | `reader` | Repository-relative paths from fxmind_query/memories only |
| Paths still missing after fxmind_query | `explore` | Must call **fxmind_query** first; no repo-wide grep |
| Bounded edits | `general` | Paths already known from fxmind |
| External docs | `scout` | Outside this repo only |

## Panel / Gate B

1. **`fxmind_query`** (or trust preloaded context).
2. **`reader`** with paths from query/memories — parallelize independent files.
3. **`explore`** only if step 1–2 still lack paths (explore uses fxmind MCP first).

When **`PANEL_MODE: quick`**: no subagents — preloaded context + fxmind MCP only.

Subagents must **not** call `fxmind_start_task`, `fxmind_record_gate`, or Judge.

When delegating to `reader`, pass the paths exactly as they appear in FxMind
memories/query. Keep them relative to the selected repository. Never turn them
into absolute paths, append `*`, or trigger `external_directory`.

## Do not delegate

- Deciding what the user meant
- Gate / quality / security judgment
- The final synthesis for the user
- Repo-wide grep (use fxmind_query instead)

Ground work in `.fxmind/memory/` and `.fxmind/skills/`.
