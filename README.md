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

# Core only — /fxmind + .fxmind/, no domain skills
npx github:fx-mind/fxmind --no-packs -y

# Explicit pack
npx github:fx-mind/fxmind --pack fivem -y
```

## Knowledge packs

| Pack | Description | Skills repo |
|------|-------------|-------------|
| `fivem` | vRP, QBCore, Qbox, ESX, NUI | [fivem-skill](https://github.com/proelias7/fivem-skill) |

Each pack ships:

- **Agent Skills** copied into your IDE/CLI
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
| `.fxmind/knowledge-graph.json` | Topic graph |
| `.fxmind/packs.json` | Installed knowledge packs |
| `reference.mdc` | Lean project map (via `/fxmind reference`) |

## Commands

| Command | Action |
|---------|--------|
| `/fxmind reference` | Generate/update `reference.mdc` |
| `/fxmind learn <topic>` | Save topic memory |
| `/fxmind audit` | Code audit (pack-specific templates when installed) |
| `/fxmind graph` | Knowledge graph + 3D map |
| `/fxmind query "…"` | Graph retrieval |

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
