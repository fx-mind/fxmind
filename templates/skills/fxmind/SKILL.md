---
name: fxmind
description: "FiveM task workflow — analyze, load .fxmind/memory, implement, then post-task learning. Router for /fxmind modes and .fxmind/skills/"
---

# fxmind

You are the **fxmind** skill — the only skill that should live in the agent skills folder.

**Pack skills** (FiveM, frameworks, NUI, etc.) are installed under **`.fxmind/skills/`** — read them when needed; do not look for them in `.cursor/skills/`, `.gemini/skills/`, `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`.

## Routing (lean)

The full `/fxmind` command body is a slim router — read **`.fxmind/fxmind.md`** for the routing table. Each mode's full spec lives in **`.fxmind/modes/<mode>.md`** — read **only the matched mode file** before acting (keeps context lean).

1. **Task** (`/fxmind task <request>`) → read **`.fxmind/modes/task.md`** (preferred for any code/config change).
2. **Other modes** (`learn`, `audit`, `graph`, `query`, `path`, `explain`, `reference`, `memory health`, `update`, `help`) → read **`.fxmind/modes/<mode>.md`**.
3. **Graph** → just run `fxmind graph` (builds + opens `.fxmind/knowledge-graph.html`).
4. **Project memories** → `.fxmind/memory/_index.md` then relevant `memory/<topic>.md`.
5. **Installed pack skills** → `.fxmind/skills/_index.md` and `.fxmind/packs.json`.
6. **Global store** → if `.fxmind/store.json` has `mode: global`, memories live in `~/.fxmind/projects/<id>/` (paths via symlink). Cross-project memories may appear in graph/query links.

## MCP fast path

If the fxmind MCP server is registered, prefer its tools over manual mode specs — they run in Node (faster, cheaper): `fxmind_list_memories`, `fxmind_query`, `fxmind_graph`, `fxmind_drift_check`, `fxmind_gate_status`, `fxmind_record_gate`.

## Task mode — Gates (enforced by hooks)

When the user runs **`task`** or asks to **change code/config**, follow the pipeline in `.fxmind/modes/task.md`. Summary:

| Phase | Required action | Output marker | Before |
|-------|-----------------|---------------|--------|
| **Gate A** | Show goal, scope, topics, risks, memory plan in chat | `🛑 GATE A COMPLETE` | Any file edit |
| **Gate B** | Read `_index.md`; load **3–5** `memory/<topic>.md`; read `.fxmind/reference.md` | `🛑 GATE B COMPLETE` | Any file edit |
| **Implement** | Edit code using memories + `.fxmind/reference.md` + skills | — | — |
| **Gate C** | Post-task learn — update memory or state "no reusable knowledge" | `🛑 GATE C COMPLETE` | Final reply |

**User corrections:** when the user fixes your mistake (wrong resource, API, approach), apply the fix then **ask if they want to save it** to `.fxmind/memory/` (AskQuestion in Cursor: Pitfalls / new topic / não salvar). See `.fxmind/modes/task.md` → *User corrections*.

Each gate MUST end with its marker. Do NOT proceed to the next phase without the previous marker being visible.

**Gate file (enforced by hooks):** after each marker, record it in **`.fxmind/fxmind-gates.json`** so the Cursor `gate-guard` hook can enforce it:

```json
{ "taskActive": true, "gates": { "A": { "complete": true }, "B": { "complete": true } } }
```

- At task start → set `taskActive: true`, `gates: {}`.
- After Gate A marker → set `gates.A.complete = true`.
- After Gate B marker → set `gates.B.complete = true` (the hook now allows code edits).
- After Gate C marker → set `gates.C.complete = true` and `taskActive: false`.

Write the file directly, or call the fxmind MCP tool `fxmind_record_gate` if the fxmind MCP server is registered. If no hooks are installed, the markers in chat are still the source of truth for the user.

## Pack skills (on demand)

| When | Read |
|------|------|
| FiveM patterns, natives, assets, framework detection | `.fxmind/skills/fivem-development/SKILL.md` |
| Audit, security, performance, Cerberus, view cache, **broadcast §1.6.1**, **quality gates §2.5** | `.fxmind/skills/fivem-development/best-practices.md` |
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
