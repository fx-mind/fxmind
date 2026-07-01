<p align="center">
  <img src="https://avatars.githubusercontent.com/u/296747387?s=200&v=4" alt="fxmind logo" width="120" />
</p>

# fxmind — project memory for AI agents

**fxmind** gives AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, OpenCode) a **shared project memory** (`.fxmind/`), a `/fxmind` command workflow, and optional **knowledge packs** of domain-specific skills.

It is a general-purpose installer + agent workflow. **FiveM** is the first knowledge pack; more can be added under `packs/`.

---

## Table of contents

- [Overview](#overview)
- [Token & time savings](#token--time-savings)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [CLI reference](#cli-reference)
  - [Install & update](#install--update)
  - [Knowledge graph](#knowledge-graph-1)
  - [Global store](#global-store-multi-project)
  - [Hooks](#hooks-cli)
  - [Pack scaffolding](#pack-scaffolding-1)
  - [MCP server](#mcp-server-1)
- [Agent commands (`/fxmind`)](#agent-commands-fxmind)
- [Task mode & Gates](#task-mode--gates)
- [Hooks (Cursor)](#hooks-cursor)
- [MCP server](#mcp-server)
- [Knowledge packs](#knowledge-packs)
- [On-demand mode specs](#on-demand-mode-specs)
- [Reproducible installs](#reproducible-installs)
- [Monorepo development](#monorepo-development)
- [Repository structure](#repository-structure)
- [License](#license)

---

## Overview

fxmind keeps everything an agent learns about a project in one place, shared across every agent you use:

| Capability | What it gives you |
|------------|-------------------|
| **Shared memory** (`.fxmind/memory/`) | Topic memories in compact English, read by all agents — no per-agent silos |
| **`/fxmind` command** | A slim router + on-demand mode specs: `task`, `learn`, `audit`, `memory health`, `graph`, `query`, `path`, `explain`, `reference`, `update` |
| **Knowledge packs** | Domain skills (FiveM, vRP, QBCore, Qbox, ESX, NUI) installed under `.fxmind/skills/` |
| **3D knowledge graph** | Interactive topic map built from memories (`fxmind graph`) |
| **Hooks** (Cursor) | Deterministic enforcement of the Task Gates + memory drift detection |
| **MCP server** | fxmind operations exposed as programmatic tools for any MCP-speaking agent |
| **Reproducible installs** | `packs.lock.json` pins pack repos + commit SHAs |

Token economy is a first-class goal: the `/fxmind` command body is a slim router, each mode's full spec is loaded **only when invoked**, and graph/query/drift run in Node (deterministic, no manual JSON assembly in the agent context).

---

## Token & time savings

fxmind does not ship a built-in analytics command (unlike [rtk](https://github.com/rtk-ai/rtk) `rtk gain`). The ranges below are **architecture-based estimates** — use your agent's context/token counter or wall-clock timing to validate on your project.

### Where tokens are saved

| Mechanism | Typical savings | When it matters most |
|-----------|-----------------|----------------------|
| **Slim router + on-demand modes** | **25–60%** of `/fxmind` instruction context per invocation | Light modes (`graph`, `help`, `query`) save the most vs the old monolithic command body |
| **Graph via `fxmind graph` (shell-out)** | **~5–20k tokens** per graph build | Projects with 15–20+ topic memories — Node writes JSON/HTML instead of the agent assembling `GRAPH_DATA` in context |
| **MCP fast path** (`fxmind_query`, `fxmind_graph`, …) | **~3–12k tokens** per query | When the graph JSON alone would dominate context; `--budget 1500` caps loaded memory |
| **Selective memory retrieval** (graph router, Gate B) | **~70–90%** vs loading all memories | Recurring topics (craft, inventory, NUI, permissions) after `/fxmind learn` |
| **Externalized audit matrix** | **~3k tokens** saved on non-audit invocations | `audit-procedure.md` loaded only on `/fxmind audit` |

**Per-mode instruction context** (router ~1.5–2k tokens + matched mode file):

| Invocation | Before (monolith) | After (router + mode) | Savings |
|------------|-------------------|------------------------|---------|
| `/fxmind task …` | ~8k | ~6k | ~25% |
| `/fxmind graph` | ~8k | ~3k | ~60% |
| `/fxmind query "…"` | ~8k | ~4k | ~45% |
| `/fxmind audit …` | ~8k | ~4k (+ procedure on demand) | ~50% outside audit |

### Where time is saved

Heavy work runs in Node instead of LLM token generation:

| Operation | Agent-only (before) | fxmind (Node / MCP) | Time saved |
|-----------|---------------------|---------------------|------------|
| Build knowledge graph | ~1–3 min (JSON in context) | `fxmind graph`: **<1–2 s** | ~99% |
| Graph query | ~30–90 s (read graph + N memories) | `fxmind_query` MCP: **~1–2 s** | ~80–95% |
| Drift check | ~10–40 s (grep + cross-ref) | `fxmind drift_check`: **<1 s** | ~90% |
| Post-learn graph refresh | Manual `/fxmind graph` | `drift-watcher` auto-rebuild in background | One step removed |

Hooks add **rework avoidance**: `gate-guard` blocks code edits before Gates A/B (fewer fix cycles); git pre-commit blocks commits when memories reference deleted files.

### Summary ranges

| Axis | Typical range | Notes |
|------|---------------|-------|
| Instruction tokens per `/fxmind` | **25–60%** | Depends on mode |
| Knowledge retrieval tokens | **70–90%** | Requires learned memories + graph |
| Graph build wall-clock | **minutes → seconds** | Always when using CLI/MCP |
| Query / drift wall-clock | **80–95%** | Best with MCP server registered |

**Caveats:** savings scale with memory count — a fresh project with no `/fxmind learn` topics gets mostly router savings (~25–60%). MCP auto-wires on `fxmind -y` for each selected agent (`--no-mcp` to skip); restart the agent client after install. Auto-rebuild requires Cursor hooks installed.

### Complementary tools

fxmind optimizes **project knowledge and workflow context** (input). Tools like **[rtk](https://github.com/rtk-ai/rtk)** optimize **shell command output** (60–90% on `git`, `cat`, `test`, `lint`, …). They address different layers and work together without code changes — fxmind merges into `.cursor/hooks.json` without removing rtk's Bash rewrite hook, and `gate-guard` only gates file-edit tools, not Bash.

---

## Quick start

```bash
# 1) Install fxmind globally (recommended)
npm install -g github:fx-mind/fxmind

# 2) In your project root — install core + the fivem pack for Cursor
cd /path/to/your-project
fxmind -y

# 3) Build the 3D knowledge map once you have topic memories
fxmind graph
```

Without a global install, prefix with `npx --yes`:

```bash
npx --yes github:fx-mind/fxmind -y
npx --yes github:fx-mind/fxmind --update -y
```

After install/update, restart the agent IDE/CLI (Gemini: `/commands reload`) and open a new agent chat so it reads the refreshed `.fxmind/fxmind.md`.

---

## How it works

```
.fxmind/
├── fxmind.md              # slim router (routing table + MCP fast path)
├── modes/<mode>.md        # on-demand mode specs (read only when invoked)
├── memory/                # shared topic memories (compact English)
├── skills/                # pack domain skills (fxmind-managed)
├── audits/                # audit reports (/fxmind audit)
├── knowledge-graph.json   # topic graph for query/path/explain
├── audit-procedure.md     # heavy audit matrix (loaded only on /fxmind audit)
├── packs.json             # installed packs manifest
└── packs.lock.json        # reproducible install pins
```

- **One skill in the agent folder** — only `fxmind` lives in `.cursor/skills/` (or `.claude/`, `.gemini/`, …). Pack skills live under `.fxmind/skills/` and are read on demand.
- **CLI vs agent split** — the terminal `fxmind` installs/updates/builds; the in-agent `/fxmind` learns, audits, queries, and runs the Task workflow.

| Run in terminal (`fxmind …`) | Run in agent (`/fxmind …`) |
|------------------------------|----------------------------|
| Install / update project setup | Learn topics, audit code |
| `fxmind graph` — build + open 3D map | `/fxmind graph` (same output) |
| `fxmind --global-store` — multi-project memory | `/fxmind query`, `path`, `explain` |
| Copy skills to `.fxmind/skills/` | `/fxmind task`, `reference`, `memory health` |
| Wire agent skill + commands | Conceptual FiveM help |
| Migrate legacy `.fivem/` layout | |

---

## CLI reference

### Install & update

| Command | Action |
|---------|--------|
| `fxmind -y` | Install default: Cursor + `fivem` pack + `/fxmind` helper |
| `fxmind -i` | Interactive — pick packs, agents, skills |
| `fxmind --update -y` | Update global fxmind (GitHub) + refresh project from `.fxmind/packs.json` (keeps memories) |
| `fxmind --update -y --no-self-update` | Refresh project only — skip `npm install -g` |
| `fxmind --no-packs -y` | Core only — `.fxmind/` + `/fxmind`, no domain skills |
| `fxmind --pack fivem -y` | Explicit knowledge pack |
| `fxmind --packs fivem,… -y` | Multiple packs (comma-separated) |
| `fxmind --all-packs -y` | Every available pack |
| `fxmind --all -y` | All skills from selected pack(s) |
| `fxmind --skills a,b -y` | Pick specific pack skills |
| `fxmind --target <dir> -y` | Install into another project root |
| `fxmind --target <dir> --update -y` | Update a specific project |
| `fxmind --no-command -y` | Skip `/fxmind` helper (pack skills only) |
| `fxmind --replace-agents --opencode -y` | Install only OpenCode; remove fxmind from other agents |
| `fxmind -h` / `--help` | Show all options |

**Agent selection** (default `-y` installs for Cursor only):

| Agent | Flag | Skill path | Command path |
|-------|------|------------|--------------|
| Cursor | `--cursor` | `.cursor/skills/fxmind/` | `.cursor/commands/fxmind.md` |
| Claude Code | `--claude` | `.claude/skills/fxmind/` | `.claude/commands/fxmind.md` |
| Codex | `--codex` | `.agents/skills/fxmind/` | (skill only) |
| Gemini CLI | `--gemini` | `.gemini/skills/fxmind/` | `.gemini/commands/fxmind/` |
| OpenCode | `--opencode` | `.opencode/skills/fxmind/` | `.opencode/commands/fxmind.md` |

Combine agents with `--agent cursor,claude,gemini -y` (alias `-a`). Installing for one agent **adds** to agents already in the project (reads `.fxmind/packs.json` + existing skill folders) — it does not remove Cursor when you run `--opencode -y`. Use `--replace-agents` only when you want to drop agents not selected in this run.

**What `--update` changes:** global `fxmind` CLI (unless `--no-self-update` or local dev install), `.fxmind/skills/`, pack templates, `knowledge-graph.html` shell, `.fxmind/fxmind.md` (slim router), `.fxmind/modes/*.md`, fxmind agent skill + commands, Cursor hooks, MCP configs for all installed agents.
**What `--update` keeps:** `.fxmind/memory/*`, `knowledge-graph.json`, learned graph data.

### Knowledge graph

```bash
fxmind graph                 # build + open 3D map in browser
fxmind graph --no-open       # write JSON/HTML only
fxmind graph --target ./proj # build for another project root
```

Builds `.fxmind/knowledge-graph.json` + `.fxmind/knowledge-graph.html` from `.fxmind/memory/`.

<p align="center">
  <img src="https://i.postimg.cc/13mZzHTy/image.png" alt="fxmind knowledge graph — 3D topic map" width="900" />
</p>

### Global store (multi-project)

One global knowledge base on your machine — **isolated per project**, with **cross-project links** in the graph when topics relate.

```bash
cd ~/projects/server-a && fxmind --global-store -y
cd ~/projects/server-b && fxmind --global-store -y
fxmind global list                 # list registered projects
fxmind graph                       # includes foreign nodes + cross-project links
fxmind --global-store --update -y  # enable on an existing project
```

| Path | Role |
|------|------|
| `~/.fxmind/registry.json` | All registered projects |
| `~/.fxmind/shared/skills/` | Pack skills (shared once) |
| `~/.fxmind/projects/<id>/memory/` | Per-project memories |
| `~/.fxmind/projects/<id>/` | Per-project graph JSON/HTML |
| `.fxmind/store.json` | Pointer from project → global data |
| `.fxmind/memory/` | Symlink → global project memory |

Agent paths stay `.fxmind/memory/` — symlinks keep compatibility. `/fxmind query` may load foreign memories when the graph links to another project.

### Hooks CLI

| Command | Action |
|---------|--------|
| `fxmind --hooks -y` | Install Cursor hooks during install |
| `fxmind --no-hooks -y` | Skip hooks even when Cursor is selected |
| `fxmind --mcp -y` | Install MCP configs for selected agents during install |
| `fxmind --no-mcp -y` | Skip MCP wiring even when agents are selected |
| `fxmind hooks install` | Install/update Cursor hooks + MCP + git pre-commit (when `.git/` exists) |
| `fxmind hooks install-git` | Install git pre-commit drift check only |
| `fxmind hooks uninstall` | Remove Cursor hooks |
| `fxmind hooks uninstall-mcp` | Remove fxmind MCP entries for installed agents |
| `fxmind hooks uninstall-git` | Remove fxmind block from `.git/hooks/pre-commit` |
| `fxmind hooks status` | Show installed hooks |
| `fxmind hooks drift-check <file>` | Check memories referencing a file |
| `fxmind hooks graph --no-open` | Build graph via the shared tooling |
| `fxmind hooks gates` | Print current Gate status from `.fxmind-gates.json` |
| `fxmind hooks pre-commit [--strict]` | Dry-run staged drift check (same logic as git hook) |

See [Hooks (Cursor)](#hooks-cursor) for behavior and environment variables.

### Pack scaffolding

```bash
fxmind pack new qbox --label Qbox --repo https://github.com/org/qbox-skill.git --default-skills qbox-framework
fxmind pack list
```

Creates `packs/<id>/pack.json` + `templates/` so adding a domain pack is no longer manual.

### MCP server

```bash
fxmind-mcp                       # stdio MCP server (target = cwd)
FXMIND_TARGET=/path fxmind-mcp
```

See [MCP server](#mcp-server) for the tool list.

---

## Agent commands (`/fxmind`)

Inside Cursor, Claude, Gemini, OpenCode, or Codex — project memory workflows (not the installer CLI).

| Command | Action |
|---------|--------|
| `/fxmind task <request>` | **Task** — analyze → load memories → implement → post-task learn (preferred for code changes) |
| `/fxmind learn <topic>` | Save/update a topic memory in `.fxmind/memory/` |
| `/fxmind audit [scope]` | Code audit → saves to `.fxmind/audits/<resource>.md` |
| `/fxmind memory health [fix] [topic]` | Verify memories vs codebase (optionally auto-fix) |
| `/fxmind graph` | Build knowledge graph + 3D map |
| `/fxmind query "…"` | Graph retrieval (BFS/DFS, budget-aware) |
| `/fxmind path <a> <b>` | Shortest path between two topics |
| `/fxmind explain <topic>` | Describe a topic node and its connections |
| `/fxmind reference` | Generate/update `reference.mdc` |
| `/fxmind update` | Prompts to run `fxmind --update -y` in the terminal |
| `/fxmind <question>` | Conceptual FiveM help |

Legacy `/fxmind <request>` without `task` still routes to Task mode. Gemini uses the `/fxmind:<mode>` form (e.g. `/fxmind:task <request>`).

---

## Task mode & Gates

Preferred for any code/config change. Gates (defined in `.cursor/skills/fxmind/SKILL.md` and `.fxmind/modes/task.md`) are **enforced by the `gate-guard` hook** via `.fxmind-gates.json`:

1. **Gate A** — show goal, scope, topics, risks, memory plan in chat **before** editing code.
2. **Gate B** — read `.fxmind/memory/_index.md` and load 3–5 relevant memories (or state none matched).
3. **Implement** — edit code using memories + `.fxmind/reference.md` + skills.
4. **Gate C** — review learning; update memory or state "no reusable knowledge".

```text
/fxmind task desative garagem no menu admin_f
```

Each Gate writes a marker to `.fxmind-gates.json` (directly or via the MCP `fxmind_record_gate` tool). Without hooks installed, the chat markers remain the source of truth.

---

## Hooks (Cursor)

Optional **project hooks** that turn the fxmind Gates and memory hygiene from prompt instructions into deterministic behavior. Installed by default when Cursor is selected; opt out with `--no-hooks`. The **MCP server** is wired automatically for each selected agent on the same conditions as install; opt out with `--no-mcp`.

```bash
fxmind hooks install     # install/update hook scripts + .cursor/hooks.json
fxmind hooks status      # show what is wired
fxmind hooks uninstall   # remove fxmind hooks
```

| Event | Script | Behavior |
|-------|--------|----------|
| `preToolUse` | `.cursor/hooks/gate-guard.js` | Blocks code edits when a fxmind task is active and Gates A/B are not recorded in `.fxmind-gates.json` (asks the user to confirm). Set `FXMIND_GATE_WARN=1` for **warn-only** mode (logs to stderr, allows the edit). |
| `postToolUse` | `.cursor/hooks/drift-watcher.js` | After a code edit, scans memories for `paths[]` referencing the file → reports `broken`/`stale-candidate`; after a `.fxmind/memory/*.md` edit, **auto-rebuilds the graph in the background** via `fxmind graph --no-open`. |
| `stop` | `.cursor/hooks/learn-prompt.js` | If a task is active with A/B complete but C missing, emits a follow-up reminding to finish post-task learning. |

Hooks are self-contained Node scripts — they read `.fxmind/` directly and do not require `fxmind` on `$PATH`.

**Environment variables:**

| Variable | Effect |
|----------|--------|
| `FXMIND_GATE_WARN=1` | `gate-guard` warn-only (allow edits, log warning) |
| `FXMIND_GRAPH_NO_AUTO=1` | Disable drift-watcher background graph rebuild |
| `FXMIND_BIN=<path>` | Override the `fxmind` binary used by the auto-rebuild |

### Git pre-commit hook

When you run `fxmind hooks install` (or `fxmind -y` with Cursor) in a git repo, fxmind also wires **`.git/hooks/pre-commit`**:

- **Blocks** the commit when a staged code file is referenced in a topic memory `paths[]` but the file no longer exists on disk (`broken`).
- **Warns** (commit allowed) when the file still exists but the memory may be outdated (`stale-candidate`).
- Set `FXMIND_PRECOMMIT_STRICT=1` or pass `--strict` to block stale hits too.

```bash
fxmind hooks install-git       # git hook only (copies pre-commit.js + lib first)
fxmind hooks uninstall-git     # remove fxmind block from .git/hooks/pre-commit
git commit --no-verify         # bypass hook when intentional
```

---

## MCP server

Expose fxmind operations as MCP tools so any MCP-speaking agent can call them programmatically instead of parsing markdown.

**Installed automatically** when you run `fxmind -y` with any selected agent (same default as MCP when `/fxmind` command is installed). Writes the `fxmind` server entry with `FXMIND_TARGET` set to your project root:

| Agent | Config file |
|-------|-------------|
| Cursor | `.cursor/mcp.json` |
| Claude Code | `.mcp.json` |
| Gemini CLI | `.gemini/settings.json` |
| OpenCode | `opencode.json` |
| Codex | `.codex/config.toml` |

Opt out with `--no-mcp`. Re-run `fxmind hooks install` or `fxmind --update -y` to refresh entries after moving the project or changing the global `fxmind-mcp` binary.

```bash
fxmind-mcp                  # stdio MCP server (target = cwd) — manual run / debug
FXMIND_TARGET=/path fxmind-mcp
fxmind hooks status         # shows MCP wired state
fxmind hooks uninstall-mcp  # remove fxmind MCP entries for installed agents
```

| Tool | Action |
|------|--------|
| `fxmind_list_memories` | List topic memories with parsed frontmatter |
| `fxmind_query` | Graph retrieval (BFS/DFS, budget-aware memory loading) |
| `fxmind_graph` | Rebuild `knowledge-graph.json` + HTML |
| `fxmind_drift_check` | Check memories referencing a file |
| `fxmind_gate_status` | Read Gate A/B/C status |
| `fxmind_record_gate` | Record a Gate marker |

Wire into an MCP client with command `fxmind-mcp` (or `node <path>/scripts/mcp-server.js`). After `fxmind -y`, each agent reads its config automatically — restart the client (MCP settings) to connect.

---

## Knowledge packs

| Pack | Description | Skills repo |
|------|-------------|-------------|
| `fivem` | vRP, QBCore, Qbox, ESX, NUI | [fivem-skill](https://github.com/proelias7/fivem-skill) |

Each pack ships:

- **Pack skills** in `.fxmind/skills/` (read on demand by the fxmind skill)
- **Agent skill** `fxmind` only in your IDE/CLI skills folder
- **Pack templates** in `.fxmind/` (e.g. FiveM `topic-catalog.md`, `audit.template.md`)
- Entry in `.fxmind/packs.json`

### Adding a new pack

```
packs/<id>/
├── pack.json           # manifest (label, skills repo, defaultSkills, templateFiles)
└── templates/          # optional domain templates for .fxmind/
```

Use `fxmind pack new <id>` to scaffold it (see [Pack scaffolding](#pack-scaffolding-1)).

---

## On-demand mode specs

The `/fxmind` command body (`.fxmind/fxmind.md`) is a **slim router**: a routing table + shared memory/skills layout + an MCP fast-path table. Each mode's full spec lives in **`.fxmind/modes/<mode>.md`** (`task`, `audit`, `learn`, `memory-health`, `graph`, `query`, `path`, `explain`, `update`, `reference`, `help`) and is read **only when that mode is invoked** — keeping per-invocation context lean.

The heavy **audit matrix** (view-cache V-a..V-j, broadcast, globals, manager events, severity/phase, report sections, rules) lives in **`.fxmind/audit-procedure.md`**, read only when `/fxmind audit` runs (on top of `.fxmind/modes/audit.md`).

If a mode or procedure file is missing, run `fxmind --update -y` to restore it.

---

## Reproducible installs

`fxmind -y` and `fxmind --update -y` write `.fxmind/packs.lock.json` capturing, per pack: skills repo URL, resolved commit SHA (when the cache is a git clone), resolved source (`sibling`/`env`/`cache`/`explicit`), and skill names. On update, fxmind prints a diff when commits or skills changed — so pack drift is visible and pinnable.

---

## Monorepo development

```
[PROJETOS]/
├── fivem-skill/skills/   # fivem pack skills source
└── fxmind/
    ├── packs/fivem/
    ├── scripts/
    └── templates/
```

```bash
cd fxmind
npm test                                            # node --test scripts/test/*.test.js
node scripts/install.js --target ../my-project --pack fivem -y
node scripts/build-graph.js --target ../my-project
```

Skills resolve in order: sibling `../fivem-skill/skills` → env `FXMIND_PACK_FIVEM_SKILLS_DIR` → git cache `~/.fxmind/packs-cache/`.

### Migrating legacy layouts

```bash
fxmind migrate              # move legacy audit-*.md → .fxmind/audits/
fxmind --update -y          # also refreshes fxmind.md + agent commands
```

If `--update` still leaves `audit-*.md` at `.fxmind/` root, the npm/GitHub package may be behind — update from this monorepo:

```bash
node /path/to/fxmind/scripts/install.js --target . --update -y
```

---

## Repository structure

```
fxmind/
├── packs/              # knowledge packs (fivem, …)
├── scripts/
│   ├── install.js      # CLI entry (install, update, graph, global, hooks, pack, migrate)
│   ├── build-graph.js  # knowledge graph builder + `fxmind graph`
│   ├── global-store.js # multi-project global store
│   ├── hooks.js        # install/manage Cursor + git hooks + CLI tooling wrappers
│   ├── mcp-install.js  # install/manage MCP configs for all supported agents
│   ├── mcp-server.js   # stdio MCP server
│   ├── fxmind-tools.js # shared logic: drift, graph, query, gates (MCP + hooks CLI)
│   ├── lockfile.js     # packs.lock.json
│   ├── pack-new.js     # `fxmind pack new` scaffolding
│   ├── packs.js
│   ├── resolve-packs.js
│   ├── lib/
│   │   └── memory-drift.js  # shared drift logic (hooks, pre-commit, tests)
│   └── test/           # node --test suite
└── templates/
    ├── commands/       # /fxmind command body (slim router)
    ├── fxmind/         # .fxmind templates (memory, audit-procedure, graph, modes/*.md, …)
    ├── hooks/          # gate-guard.js, drift-watcher.js, learn-prompt.js, hooks.json
    ├── rules/
    └── skills/         # fxmind agent skill
```

---

## License

MIT — **[proelias7](https://github.com/proelias7)**
