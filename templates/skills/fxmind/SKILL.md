---
name: fxmind
description: "Use for any request that changes, fixes, implements, refactors, adds, removes, disables, enables, or configures code in this project — especially when .fxmind/ exists. Automatically runs the fxmind Task pipeline (classify → A → B → implement → V → learn) without requiring /fxmind task. Also routes /fxmind modes (learn, audit, judge, query, graph, …) and pack skills under .fxmind/skills/."
---

# fxmind

You are the **fxmind** skill — the only skill that should live in the agent skills folder.

**Pack skills** (FiveM, frameworks, NUI, etc.) are installed under **`.fxmind/skills/`** — read them when needed; do not look for them in `.cursor/skills/`, `.github/skills/`, `.gemini/skills/`, `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`.

## Auto Task (default)

If the user asks to **change** code/config — classify (see `.fxmind/modes/task.md`) then run the pipeline. Verify details: **`.fxmind/modes/task-verify.md`**.

**Panel context:** if the attached FxMind context file says `PANEL_MODE: quick`, treat implementation as **trivial** (see task.md § Panel quick mode). If `PANEL_MODE: full`, use the full pipeline.

- **question** → answer only (no edit)
- **analyze-only** → report + AskQuestion; no edit until approved ("analisa e corrige" = full task)
- **trivial** → `fxmind_start_task` `{ trivial: true }` → edit → V → C
- **task / plan-first** → A → B → implement → V → (judge if required) → C

`/fxmind task <request>` is optional shorthand for the implementation pipeline.

## Routing (lean)

The full `/fxmind` command body is a slim router — read **`.fxmind/fxmind.md`** for the routing table. Each mode's full spec lives in **`.fxmind/modes/<mode>.md`** — read **only the matched mode file** before acting (keeps context lean).

1. **Task** (any implementation request, with or without `/fxmind task`) → read **`.fxmind/modes/task.md`**.
2. **Judge** (`judge`, "did that actually work?", verify claims) → read **`.fxmind/modes/judge.md`**.
3. **Other modes** (`learn`, `audit`, `graph`, `painel`, `query`, `path`, `explain`, `reference`, `memory health`, `update`, `help`) → read **`.fxmind/modes/<mode>.md`**.
4. **Graph** → just run `fxmind graph` (builds + opens `.fxmind/graph/knowledge-graph.html`).
4b. **Painel** (`painel` / `panel`) → read `.fxmind/modes/painel.md`: open the panel, then **stay in this chat** as host (no API key, no `agent login`).
5. **Project memories** → `.fxmind/memory/_index.md` then relevant `memory/<topic>.md`.
6. **Installed pack skills** → `.fxmind/skills/_index.md` and `.fxmind/packs.json`.
7. **Global store** → if `.fxmind/store.json` has `mode: global`, memories live in `~/.fxmind/projects/<id>/` (paths via symlink). Cross-project memories may appear in graph/query links.
8. **Failure modes** → `.fxmind/policy/failure-modes.md`
9. **Task verify** → `.fxmind/modes/task-verify.md` (after Implement)
10. **Minimum evidence** (FiveM pack) → `.fxmind/policy/minimum-evidence.md` when present

## MCP fast path (mandatory)

**Always** use fxmind MCP tools when connected — they are optimized for fast delivery (Node, indexed graph, gates, FiveM, DB). **Do not** replace them with grep, find, or ad-hoc shell search.

Required tools: `fxmind_list_memories`, `fxmind_validate_memories`, `fxmind_query`, `fxmind_graph`, `fxmind_drift_check`, `fxmind_start_task`, `fxmind_gate_status`, `fxmind_record_gate`, `fxmind_record_correction`, `fxmind_list_corrections`, `fxmind_fivem_install`, `fxmind_fivem_cmd`, `fxmind_fivem_console_tail`, `fxmind_fivem_status`, `fxmind_db_status`, `fxmind_db_query`, `fxmind_db_schema`, `fxmind_db_sample`, `fxmind_db_explore`, `fxmind_db_analyze`, `fxmind_panel_wait`, `fxmind_panel_pending`, `fxmind_panel_reply`, `fxmind_panel_fail`.

If fxmind MCP is **not** in your tool list → **STOP** the task pipeline; ask the user to enable it (`fxmind hooks install` on Windows if mcp.json fails).

**FiveM console — availability gate (before ensure/tail):**

1. If `fxmind_fivem_*` MCP tools are **not** in your tool list → **skip** RCON and log tail; tell the user to run `ensure`/`restart` manually in the FXServer console (and paste output if Gate V needs it).
2. Otherwise call **`fxmind_fivem_status`** first. Use `fxmind_fivem_cmd` / `fxmind_fivem_console_tail` **only** when `available: true`.
3. `installed: false` or `passwordSet: false` → **`fxmind_fivem_install`** once (dev only — writes **dev/dev.cfg** only), ask user to restart **fivem-start**, then stop — do not call `fxmind_fivem_cmd` until they confirm.
4. `installed: true` but `serverReachable: false` / `available: false` → **skip** automation; ask user to start **fivem-start** and run the console command manually.
5. Max one install attempt; no retry loops on dead RCON.

**After editing a FiveM resource (when available):** call `fxmind_fivem_cmd` (`ensure`/`restart`) yourself.

**Live debug (when available):** tagged `print`s → ensure via MCP → user reproduces in-game → you read **`fxmind_fivem_console_tail`** → fix → remove prints. For NUI/UI logic, prefer structured vision over screenshots — **you** configure and clean up:

1. `fxmind_fivem_nui_wire` with the target resource (patches fxmanifest + injects probe; do not ask the user to edit)
2. `ensure` bridge + resource → user opens NUI in-game
3. `fxmind_fivem_nui_dump`
4. **`fxmind_fivem_nui_unwire` before finishing / Gate C** (mandatory — never leave the probe)

When MCP or FXServer is unavailable, ask the user to reproduce and share console output instead.

**MySQL:** connection comes from `mysql_connection_string` in cfg (oxmysql). Prefer `fxmind_db_schema` / `fxmind_db_sample` before ad-hoc SQL. For **DELETE/DROP/TRUNCATE**, AskQuestion the user first; only then call `fxmind_db_query` with `approvedByUser: true`. Never invent approval.

## Task mode — Gates (enforced by hooks)

When the user asks to **change code/config** (with or without `/fxmind task`), follow the pipeline in `.fxmind/modes/task.md`. Summary:

| Phase | Required action | Output marker | Before |
|-------|-----------------|---------------|--------|
| **Classify** | One CLASS: question / analyze-only / plan-first / trivial / task | — | Start |
| **Start** | `fxmind_start_task` (`trivial: true` when CLASS=trivial) | — | Gate A |
| **Gate A** | CLASS, goal, Done+verify, INTENT if needed, scope, **QUALITY** (FiveM) | `🛑 GATE A COMPLETE` | Any file edit |
| **Gate B** | Memories + reference + corrections + primary sources | `🛑 GATE B COMPLETE` | Any file edit |
| **Implement** | Surgical edits; diff self-review (FiveM); max 3 retries | — | — |
| **Gate V** | Read `task-verify.md`; REVIEW + PARITY + observe Done (+ TWINS) | `🛑 GATE V COMPLETE` | Gate C |
| **Judge** | If task-verify says mandatory → `.fxmind/modes/judge.md` | verdict line | Final success claim |
| **Gate C** | Learn or "mudança pontual" (**MCP rejects C without V**) | `🛑 GATE C COMPLETE` | Final reply |

**User corrections:** when the user fixes your mistake, ask whether to save to memory Pitfalls and/or **`.fxmind/corrections/`** via MCP `fxmind_record_correction` (skill-improvement backlog). See `.fxmind/modes/task.md` → *User corrections*.

Each gate MUST end with its marker. Do NOT proceed to the next phase without the previous marker being visible.

**Gates = MCP only (never Write the JSON):**

- Call **`fxmind_start_task`** at task start.
- After each marker → **`fxmind_record_gate`** with `gate: "A"|"B"|"V"|"C"`.
- Gate C clears `taskActive` automatically.
- Do **not** Write/Edit `.fxmind/state/fxmind-gates.json` — the `gate-guard` hook blocks it.
- If MCP is unavailable: chat markers are the source of truth for the user; hooks cannot be satisfied without MCP/CLI (`fxmind hooks gates`).

After learn/Gate C memory writes, call **`fxmind_validate_memories`** (or run `fxmind memory validate`) and fix errors before finishing.

## Pack skills (on demand)

| When | Read |
|------|------|
| FiveM patterns, natives, assets, framework detection | `.fxmind/skills/fivem-development/SKILL.md` |
| Audit, security, performance, Cerberus, view cache, **broadcast §1.6.1**, **quality gates §2.5** | `.fxmind/skills/fivem-development/performance.md` (+ `security.md`; index: `best-practices.md`) |
| **Implement / refactor FiveM code (task mode DoD)** | `.fxmind/skills/fivem-development/quality-gates.md` |
| vRP Creative / vRP API | `.fxmind/skills/vrp-framework/SKILL.md` |
| QBCore | `.fxmind/skills/qbcore-framework/SKILL.md` |
| Qbox | `.fxmind/skills/qbox-framework/SKILL.md` |
| ESX | `.fxmind/skills/esx-framework/SKILL.md` |
| NUI / React UI | `.fxmind/skills/fivem-react-nui/SKILL.md` |

Only read skills listed in `.fxmind/skills/_index.md` — skip missing paths.

## OpenCode subagents

When this project is installed with `--opencode`, use Task:

| Need | Subagent |
|------|----------|
| Find files / grep | `explore` |
| Read known paths | `reader` |
| Bounded edit | `general` |
| External docs / natives | `scout` |

Do not ask `explore` to fetch the web, `scout` to grep this repo, `reader` to discover files, or `general` to redesign the feature. Orchestration: `.opencode/instructions/delegate-io.md`.

## Shared memory (never per-agent)

| Path | Role |
|------|------|
| `.fxmind/memory/<topic>.md` | Topic memories |
| `.fxmind/audits/<resource>.md` | Audit reports (**never** `.fxmind/audit-*.md` at root) |
| `.fxmind/graph/knowledge-graph.json` | Graph for query/path/explain |
| `.fxmind/policy/topic-catalog.md` | Learn search hints |
| `.fxmind/reference.md` | Project map — paths, flows, anti-bug notes (all agents) |
| `.fxmind/store.json` | Global store pointer when enabled |
| `.fxmind/packs.json` | Installed packs + `storage: global|local` |

**Write policy:** `learn`, `memory health fix`, and `graph` write only to `.fxmind/`. `audit` writes only to `.fxmind/audits/`.
