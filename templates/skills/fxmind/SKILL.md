---
name: fxmind
description: "Use for any request that changes, fixes, implements, refactors, adds, removes, disables, enables, or configures code in this project — especially when .fxmind/ exists. Automatically runs the fxmind Task pipeline (analyze → load memories → implement → learn) without requiring /fxmind task. Also routes /fxmind modes (learn, audit, query, graph, …) and pack skills under .fxmind/skills/."
---

# fxmind

You are the **fxmind** skill — the only skill that should live in the agent skills folder.

**Pack skills** (FiveM, frameworks, NUI, etc.) are installed under **`.fxmind/skills/`** — read them when needed; do not look for them in `.cursor/skills/`, `.gemini/skills/`, `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`.

## Auto Task (default)

If the user asks to change code/config — **start Task mode immediately**. Do not wait for `/fxmind task`. Read **`.fxmind/modes/task.md`**, activate gates, then Gate A → B → implement → C.

`/fxmind task <request>` is optional shorthand for the same pipeline.

## Routing (lean)

The full `/fxmind` command body is a slim router — read **`.fxmind/fxmind.md`** for the routing table. Each mode's full spec lives in **`.fxmind/modes/<mode>.md`** — read **only the matched mode file** before acting (keeps context lean).

1. **Task** (any implementation request, with or without `/fxmind task`) → read **`.fxmind/modes/task.md`**.
2. **Other modes** (`learn`, `audit`, `graph`, `query`, `path`, `explain`, `reference`, `memory health`, `update`, `help`) → read **`.fxmind/modes/<mode>.md`**.
3. **Graph** → just run `fxmind graph` (builds + opens `.fxmind/knowledge-graph.html`).
4. **Project memories** → `.fxmind/memory/_index.md` then relevant `memory/<topic>.md`.
5. **Installed pack skills** → `.fxmind/skills/_index.md` and `.fxmind/packs.json`.
6. **Global store** → if `.fxmind/store.json` has `mode: global`, memories live in `~/.fxmind/projects/<id>/` (paths via symlink). Cross-project memories may appear in graph/query links.

## MCP fast path

If the fxmind MCP server is registered, prefer its tools over manual mode specs — they run in Node (faster, cheaper): `fxmind_list_memories`, `fxmind_validate_memories`, `fxmind_query`, `fxmind_graph`, `fxmind_drift_check`, `fxmind_start_task`, `fxmind_gate_status`, `fxmind_record_gate`, `fxmind_record_correction`, `fxmind_list_corrections`, `fxmind_fivem_install`, `fxmind_fivem_cmd`, `fxmind_fivem_console_tail`, `fxmind_fivem_status`.

**FiveM local setup:** if `fxmind_fivem_status` shows `passwordSet: false` (or ensure fails with missing password), call **`fxmind_fivem_install`** once, then ask the user to restart the **fivem-start** task. Do not hand-edit cfg/tasks when this tool exists.

**After editing a FiveM resource:** call `fxmind_fivem_cmd` (`ensure`/`restart`) yourself. **Do not ask the user** to run ensure/restart.

**Live debug:** tagged `print`s → ensure via MCP → user reproduces in-game → you read **`fxmind_fivem_console_tail`** (last lines of `.fxmind/fivem-console.log` mirrored by the in-Cursor `fivem-start` task) → fix → remove prints. Never ask the user to paste logs.

## Task mode — Gates (enforced by hooks)

When the user asks to **change code/config** (with or without `/fxmind task`), follow the pipeline in `.fxmind/modes/task.md`. Summary:

| Phase | Required action | Output marker | Before |
|-------|-----------------|---------------|--------|
| **Start** | Call MCP `fxmind_start_task` (or `fxmind_record_gate` gate=START) | — | Gate A |
| **Gate A** | Show goal, scope, topics, risks, memory plan in chat | `🛑 GATE A COMPLETE` | Any file edit |
| **Gate B** | Load memories via `fxmind_query` (or index + 3–5 files); read `.fxmind/reference.md` | `🛑 GATE B COMPLETE` | Any file edit |
| **Implement** | Edit code using memories + `.fxmind/reference.md` + skills | — | — |
| **Gate C** | Post-task learn — update memory or state "no reusable knowledge" | `🛑 GATE C COMPLETE` | Final reply |

**User corrections:** when the user fixes your mistake, ask whether to save to memory Pitfalls and/or **`.fxmind/corrections/`** via MCP `fxmind_record_correction` (skill-improvement backlog). See `.fxmind/modes/task.md` → *User corrections*.

Each gate MUST end with its marker. Do NOT proceed to the next phase without the previous marker being visible.

**Gates = MCP only (never Write the JSON):**

- Call **`fxmind_start_task`** at task start.
- After each marker → **`fxmind_record_gate`** with `gate: "A"|"B"|"C"`.
- Gate C clears `taskActive` automatically.
- Do **not** Write/Edit `.fxmind/fxmind-gates.json` — the `gate-guard` hook blocks it.
- If MCP is unavailable: chat markers are the source of truth for the user; hooks cannot be satisfied without MCP/CLI (`fxmind hooks gates`).

After learn/Gate C memory writes, call **`fxmind_validate_memories`** (or run `fxmind memory validate`) and fix errors before finishing.

## Pack skills (on demand)

| When | Read |
|------|------|
| FiveM patterns, natives, assets, framework detection | `.fxmind/skills/fivem-development/SKILL.md` |
| Audit, security, performance, Cerberus, view cache, **broadcast §1.6.1**, **quality gates §2.5** | `.fxmind/skills/fivem-development/performance.md` (+ `security.md`; index: `best-practices.md`) |
| vRP Creative / vRP API | `.fxmind/skills/vrp-framework/SKILL.md` |
| QBCore | `.fxmind/skills/qbcore-framework/SKILL.md` |
| Qbox | `.fxmind/skills/qbox-framework/SKILL.md` |
| ESX | `.fxmind/skills/esx-framework/SKILL.md` |
| NUI / React UI | `.fxmind/skills/fivem-react-nui/SKILL.md` |

Only read skills listed in `.fxmind/skills/_index.md` — skip missing paths.

## Shared memory (never per-agent)

| Path | Role |
|------|------|
| `.fxmind/memory/<topic>.md` | Topic memories |
| `.fxmind/audits/<resource>.md` | Audit reports (**never** `.fxmind/audit-*.md` at root) |
| `.fxmind/knowledge-graph.json` | Graph for query/path/explain |
| `.fxmind/topic-catalog.md` | Learn search hints |
| `.fxmind/reference.md` | Project map — paths, flows, anti-bug notes (all agents) |
| `.fxmind/store.json` | Global store pointer when enabled |
| `.fxmind/packs.json` | Installed packs + `storage: global|local` |

**Write policy:** `learn`, `memory health fix`, and `graph` write only to `.fxmind/`. `audit` writes only to `.fxmind/audits/`.
