<p align="center">
  <img src="https://avatars.githubusercontent.com/u/296747387?s=200&v=4" alt="fxmind logo" width="120" />
</p>

# fxmind — project memory for AI agents

**fxmind** is a general-purpose installer: shared project memory (`.fxmind/`), `/fxmind` commands, and optional **knowledge packs** with domain-specific Agent Skills.

**FiveM** is the first knowledge pack. More packs can be added under `packs/`.

## CLI (`fxmind`)

Terminal commands — install, update, build the knowledge graph, and sync project files. Learn/audit stay in the agent (`/fxmind`).

```bash
fxmind graph                 # build + open 3D map in browser
fxmind graph --no-open       # write JSON/HTML only
fxmind graph --target ./proj
```

### Global install (recommended)

```bash
npm install -g github:fx-mind/fxmind

cd /path/to/your-fivem-project
fxmind -y                  # install (Cursor + fivem pack)
fxmind --update -y         # refresh packs/skills/templates (keeps memories)
fxmind graph               # build 3D knowledge graph + open browser
fxmind -h                  # full help
```

### Without global install (`npx`)

```bash
npx --yes github:fx-mind/fxmind -y
npx --yes github:fx-mind/fxmind --update -y
npx --yes github:fx-mind/fxmind -h
```

### CLI reference

| Command | Action |
|---------|--------|
| `fxmind -y` | Install default: Cursor + `fivem` pack + `/fxmind` helper |
| `fxmind --update -y` | Refresh from `.fxmind/packs.json` — pull pack skills, update templates, fxmind agent skill |
| `fxmind graph` | Build `.fxmind/knowledge-graph.json` + HTML from memories; open in browser |
| `fxmind graph --no-open` | Build graph files without opening the browser |
| `fxmind graph --target <dir>` | Build graph for another project root |
| `fxmind --global-store -y` | Global store — memories/graph per project under `~/.fxmind/projects/` |
| `fxmind global list` | List all projects in the global store |
| `fxmind --target <dir> -y` | Install into another project root |
| `fxmind --target <dir> --update -y` | Update a specific project |
| `fxmind --pack fivem -y` | Explicit knowledge pack |
| `fxmind --packs fivem,… -y` | Multiple packs (comma-separated) |
| `fxmind --all-packs -y` | Every available pack |
| `fxmind --no-packs -y` | Core only — `.fxmind/` + `/fxmind`, no domain skills |
| `fxmind --all -y` | All skills from selected pack(s) |
| `fxmind --skills a,b -y` | Pick specific pack skills |
| `fxmind --cursor -y` | Cursor only (see agent flags below) |
| `fxmind --claude -y` | Claude Code only |
| `fxmind --codex -y` | Codex only |
| `fxmind --gemini -y` | Gemini CLI only |
| `fxmind --opencode -y` | OpenCode only |
| `fxmind --agent cursor,claude -y` | Multiple agents (`-a` alias) |
| `fxmind --no-command -y` | Skip `/fxmind` helper (pack skills only) |
| `fxmind -i` | Interactive — pick packs, agents, skills |
| `fxmind -h` / `--help` | Show all options |

**What `--update` changes:** `.fxmind/skills/`, pack templates, `knowledge-graph.html` shell, `.fxmind/fxmind.md`, fxmind agent skill + commands.

**What `--update` keeps:** `.fxmind/memory/*`, `knowledge-graph.json`, learned graph data.

After CLI install/update, restart the agent IDE/CLI (Gemini: `/commands reload`).

### Global store (multi-project)

Use one global knowledge base on your machine — **isolated per project**, with **cross-project links** in the graph when topics relate.

```bash
# First project
cd ~/projects/server-a
fxmind --global-store -y

# Second project (same machine)
cd ~/projects/server-b
fxmind --global-store -y

# List registered projects
fxmind global list

# Graph includes foreign nodes + cross-project links when relevant
fxmind graph
```

| Path | Role |
|------|------|
| `~/.fxmind/registry.json` | All registered projects |
| `~/.fxmind/shared/skills/` | Pack skills (shared once) |
| `~/.fxmind/projects/<id>/memory/` | Per-project memories |
| `~/.fxmind/projects/<id>/` | Per-project graph JSON/HTML |
| `.fxmind/store.json` | Pointer from project → global data |
| `.fxmind/memory/` | Symlink → global project memory |

Agent paths stay `.fxmind/memory/` — symlinks keep compatibility. `/fxmind query` may load foreign memories when graph links to another project.

Migrate an existing local install: `fxmind --global-store --update -y`

### CLI vs agent

| Run in terminal (`fxmind …`) | Run in agent (`/fxmind …`) |
|------------------------------|----------------------------|
| Install / update project setup | Learn topics, audit code |
| `fxmind --global-store` — multi-project memory | Query graph (incl. cross-project links) |
| `fxmind graph` — build + open 3D map | Query graph, path, explain |
| Copy skills to `.fxmind/skills/` | Task workflow, reference, memory health |
| Wire agent skill + commands | Conceptual FiveM help |
| Migrate legacy `.fivem/` layout | `/fxmind graph` (same output as CLI) |

## Installation

Quick copies of the CLI above — use `fxmind` if installed globally, or `npx --yes github:fx-mind/fxmind`:

```bash
# Interactive — choose packs, agents, skills
fxmind -i

# Default: core + fivem pack (Cursor)
fxmind -y

# Refresh after pack/skill updates (memories preserved)
fxmind --update -y

# Core only — /fxmind + .fxmind/, no domain skills
fxmind --no-packs -y

# Explicit pack
fxmind --pack fivem -y
```

### Install for specific agents

By default, `-y` installs for **Cursor** only. Target one or more agents with flags:

```bash
# Single agent
fxmind --cursor -y
fxmind --claude -y
fxmind --codex -y
fxmind --gemini -y
fxmind --opencode -y

# Multiple agents (comma-separated)
fxmind --agent cursor,claude,gemini -y
fxmind -a cursor,codex -y

# Agent + pack + update
fxmind --gemini --pack fivem -y
fxmind --cursor --update -y
fxmind --claude --no-packs -y
```

| Agent | Flag | Skill path | Command path |
|-------|------|------------|--------------|
| Cursor | `--cursor` | `.cursor/skills/fxmind/` | `.cursor/commands/fxmind.md` |
| Claude Code | `--claude` | `.claude/skills/fxmind/` | `.claude/commands/fxmind.md` |
| Codex | `--codex` | `.agents/skills/fxmind/` | (skill only) |
| Gemini CLI | `--gemini` | `.gemini/skills/fxmind/` | `.gemini/commands/fxmind/` |
| OpenCode | `--opencode` | `.opencode/skills/fxmind/` | `.opencode/commands/fxmind.md` |

Shared `.fxmind/` (memory, pack skills, graph) is the same for all agents — install once per project, even when using multiple agent flags.

```bash
cd fxmind
node scripts/install.js --target ../my-project --pack fivem --cursor -y
node scripts/install.js --target ../my-project --agent cursor,claude --update -y
```

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

## Core (always with `/fxmind`)

| Path | Role |
|------|------|
| `.fxmind/memory/` | Shared topic memories |
| `.fxmind/audits/` | Audit reports (`/fxmind audit`) |
| `.fxmind/skills/` | Pack domain skills (fxmind-managed) |
| `.fxmind/knowledge-graph.json` | Topic graph |
| `.fxmind/packs.json` | Installed knowledge packs |
| `reference.mdc` | Lean project map (via `/fxmind reference`) |

## Knowledge graph

Interactive 3D map — run **`fxmind graph`** (CLI) or **`/fxmind graph`** (agent) after learning topics.

<p align="center">
  <img src="https://i.postimg.cc/13mZzHTy/image.png" alt="fxmind knowledge graph — 3D topic map" width="900" />
</p>

## Agent commands (`/fxmind`)

Inside Cursor, Claude, Gemini, OpenCode, or Codex — project memory workflows (not the installer CLI).

| Command | Action |
|---------|--------|
| `/fxmind reference` | Generate/update `reference.mdc` |
| `/fxmind learn <topic>` | Save topic memory |
| `/fxmind audit` | Code audit (pack-specific templates when installed) |
| `/fxmind graph` | Knowledge graph + 3D map |
| `/fxmind query "…"` | Graph retrieval |
| `/fxmind path <a> <b>` | Shortest path between topics |
| `/fxmind explain <topic>` | Describe a topic node |
| `/fxmind memory health` | Verify memories vs codebase |
| `/fxmind update` | Prompts to run `fxmind --update -y` in terminal |

To refresh skills/templates after upstream changes, use the **CLI**: `fxmind --update -y` (see [CLI](#cli-fxmind)).

## Monorepo dev

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
node scripts/install.js --target ../my-project --pack fivem -y
node scripts/build-graph.js --target ../my-project
```

Skills resolve: sibling `../fivem-skill/skills` → env `FXMIND_PACK_FIVEM_SKILLS_DIR` → git cache `~/.fxmind/packs-cache/`.

## Repo structure

```
fxmind/
├── packs/              # knowledge packs (fivem, …)
├── scripts/
│   ├── install.js
│   ├── packs.js
│   └── resolve-packs.js
└── templates/          # core /fxmind command + generic .fxmind templates
```

## License

MIT — **[proelias7](https://github.com/proelias7)**
