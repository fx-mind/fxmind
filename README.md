<p align="center">
  <img src="https://avatars.githubusercontent.com/u/296747387?s=200&v=4" alt="fxmind logo" width="120" />
</p>

# fxmind — project memory for AI agents

**fxmind** is a general-purpose installer: shared project memory (`.fxmind/`), `/fxmind` commands, and optional **knowledge packs** with domain-specific Agent Skills.

**FiveM** is the first knowledge pack. More packs can be added under `packs/`.

## Installation

```bash
# Interactive — choose packs, agents, skills
npx github:fx-mind/fxmind

# Default: core + fivem pack
npx github:fx-mind/fxmind -y

# Refresh skills/templates after pack updates (keeps memories)
npx github:fx-mind/fxmind --update -y

# Core only — /fxmind + .fxmind/, no domain skills
npx github:fx-mind/fxmind --no-packs -y

# Explicit pack
npx github:fx-mind/fxmind --pack fivem -y
```

### Install for specific agents

By default, `-y` installs for **Cursor** only. Target one or more agents with flags:

```bash
# Single agent
npx github:fx-mind/fxmind --cursor -y
npx github:fx-mind/fxmind --claude -y
npx github:fx-mind/fxmind --codex -y
npx github:fx-mind/fxmind --gemini -y
npx github:fx-mind/fxmind --opencode -y

# Multiple agents (comma-separated)
npx github:fx-mind/fxmind --agent cursor,claude,gemini -y
npx github:fx-mind/fxmind -a cursor,codex -y

# Agent + pack + update examples
npx github:fx-mind/fxmind --gemini --pack fivem -y
npx github:fx-mind/fxmind --cursor --update -y
npx github:fx-mind/fxmind --claude --no-packs -y
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
| `.fxmind/skills/` | Pack domain skills (fxmind-managed) |
| `.fxmind/knowledge-graph.json` | Topic graph |
| `.fxmind/packs.json` | Installed knowledge packs |
| `reference.mdc` | Lean project map (via `/fxmind reference`) |

## Knowledge graph

Interactive 3D map from `/fxmind graph` — learned topics, cross-links, filters, and node details.

<p align="center">
  <img src="https://i.postimg.cc/13mZzHTy/image.png" alt="fxmind knowledge graph — 3D topic map" width="900" />
</p>

## Commands

| Command | Action |
|---------|--------|
| `/fxmind reference` | Generate/update `reference.mdc` |
| `/fxmind learn <topic>` | Save topic memory |
| `/fxmind audit` | Code audit (pack-specific templates when installed) |
| `/fxmind graph` | Knowledge graph + 3D map |
| `/fxmind query "…"` | Graph retrieval |
| `/fxmind update` | Refresh pack skills & templates (or `fxmind --update -y`) |

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
node scripts/install.js --target ../my-project --pack fivem --cursor -y
node scripts/install.js --target ../my-project --agent cursor,claude --update -y
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
