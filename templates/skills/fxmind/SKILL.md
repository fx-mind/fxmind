---
name: fxmind
description: Project memory router — /fxmind modes, shared .fxmind/ memory, and on-demand pack skills under .fxmind/skills/
---

# fxmind

You are the **fxmind** skill — the only skill that should live in the agent skills folder.

**Pack skills** (FiveM, frameworks, NUI, etc.) are installed under **`.fxmind/skills/`** — read them when needed; do not look for them in `.cursor/skills/`, `.gemini/skills/`, `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`.

## Routing

1. **Modes** (`/fxmind learn`, `audit`, `graph`, `query`, task workflow, …) → read **`.fxmind/fxmind.md`**
2. **Graph (CLI)** → `fxmind graph` builds + opens `.fxmind/knowledge-graph.html`
3. **Project memories** → **`.fxmind/memory/_index.md`** then relevant `memory/<topic>.md`
4. **Installed pack skills** → **`.fxmind/skills/_index.md`** and **`.fxmind/packs.json`**
5. **Global store** → if `.fxmind/store.json` has `mode: global`, memories live in `~/.fxmind/projects/<id>/` (paths via symlink). Cross-project memories may appear in graph/query links.

## Pack skills (on demand)

| When | Read |
|------|------|
| FiveM patterns, natives, assets, framework detection | `.fxmind/skills/fivem-development/SKILL.md` |
| Audit, security, performance, Cerberus, view cache, **broadcast §1.6.1** | `.fxmind/skills/fivem-development/best-practices.md` |
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
| `.fxmind/knowledge-graph.json` | Graph for query/path/explain |
| `.fxmind/topic-catalog.md` | Learn search hints |
| `.fxmind/store.json` | Global store pointer when enabled |
| `.fxmind/packs.json` | Installed packs + `storage: global|local` |

**Write policy:** `learn`, `memory health fix`, and `graph` write only to `.fxmind/`. `audit` writes only to `.fxmind/audits/`.
