<p align="center">
  <img src="https://avatars.githubusercontent.com/u/296747387?s=200&v=4" alt="fxmind logo" width="120" />
</p>

# fxmind — shared project memory for AI agents

**fxmind** installs shared project memory (`.fxmind/`), a `/fxmind` command workflow, and optional domain **knowledge packs** into your repo. Works with **Cursor**, **Claude Code**, **Codex**, **Gemini CLI**, and **OpenCode**.

The first pack is **FiveM** (vRP, QBCore, Qbox, ESX, NUI). More domains can be added under `packs/`.

---

## Quick start

```bash
# From your project root
npx --yes github:fx-mind/fxmind -y

# After creating memories with /fxmind learn
npx --yes github:fx-mind/fxmind graph
```

Optional global install (faster day-to-day):

```bash
npm install -g github:fx-mind/fxmind
fxmind -y
```

Restart your agent IDE/CLI after install or update.

---

## What fxmind gives you

| Feature | Description |
|---------|-------------|
| **Memory** (`.fxmind/memory/`) | Topic memories in compact English, shared across all agents |
| **`/fxmind`** | Chat command + **auto Task** for code changes (no slash required) |
| **Packs** | Domain skills under `.fxmind/skills/` (e.g. FiveM) |
| **3D graph** | Visual topic map (`fxmind graph`) |
| **Hooks** (Cursor) | Task gates + stale-memory detection |
| **MCP** | Programmatic tools (`fxmind_query`, `fxmind_graph`, …) |

**Split:** terminal (`fxmind …`) installs and builds; chat (`/fxmind …`) learns, audits, and implements.

---

## Day-to-day usage

### In the agent chat

| Command | Purpose |
|---------|---------|
| `/fxmind task <request>` | Explicit Task shortcut (optional — natural language also auto-runs Task) |
| `/fxmind learn <topic>` | Save or update a topic memory |
| `/fxmind query "…"` | Search the knowledge graph |
| `/fxmind audit [scope]` | Code audit → `.fxmind/audits/` |
| `/fxmind graph` | Rebuild the 3D knowledge graph |
| `/fxmind memory health` | Verify memories against the codebase |
| `/fxmind update` | Prompts to run `fxmind --update -y` in the terminal |

Gemini uses `/fxmind:task`, `/fxmind:learn`, etc.

### In the terminal

```bash
fxmind -y                  # install (Cursor + fivem pack by default)
fxmind --update -y         # refresh templates/skills (keeps memories)
fxmind graph               # open 3D graph in the browser
fxmind hooks status        # show hooks + MCP status
fxmind -h                  # all options
```

**Agents** — `--cursor`, `--claude`, `--gemini`, `--opencode`, `--codex`, or `--agent cursor,claude -y`.

**Packs** — `--pack fivem`, `--no-packs` (core only), `--all-packs`.

---

## Project layout

```
.fxmind/
├── memory/              # topic memories (source of truth)
├── memory-index.json    # compiled frontmatter index (from fxmind graph)
├── skills/              # pack skills
├── modes/               # /fxmind mode specs (loaded on demand)
├── knowledge-graph.json # graph for query/path/explain
├── packs.json           # installed packs manifest
└── fxmind.md            # /fxmind command router
```

Session-only (gitignored): `fxmind-gates.json`, `metrics.jsonl`.

**Corrections backlog** (commit these — skill feed): `.fxmind/corrections/` — human fixes of agent mistakes, separate from topic memories. Export with `fxmind corrections export` → edit the matching `fivem-development/<category>.md`.
---

## Task mode & Gates

Just ask for the change in natural language — Task mode runs **automatically** (no `/fxmind task` required). With Cursor hooks installed:

1. **Classify** — `question` / `analyze-only` / `plan-first` / `trivial` / `task` (see `.fxmind/modes/task.md`)
2. **Start** — MCP `fxmind_start_task` (`trivial: true` auto-completes A+B)
3. **Gate A** — CLASS, Done+verify, INTENT if needed → `fxmind_record_gate` A
4. **Gate B** — load memories → `fxmind_record_gate` B
5. **Implement** — surgical edits; max 3 fix→verify retries
6. **Gate V** — read `.fxmind/modes/task-verify.md`; observe Done (+ TWINS) → `fxmind_record_gate` V (**required before C**)
7. **Judge** — when task-verify says mandatory (blast radius / money-permission / INTENT)
8. **Gate C** — post-task learn → `fxmind_record_gate` C (clears session)

Prove claims: **`/fxmind judge`**. Behavioral map: `.fxmind/failure-modes.md`. FiveM evidence: `.fxmind/minimum-evidence.md`.

**Gates are session state (MCP only).** Agents must not Write `.fxmind/fxmind-gates.json` — `gate-guard` blocks it. The file is gitignored (ephemeral).

`/fxmind task <request>` still works as an explicit shortcut.

---

## Memory quality

Memories stay as **Markdown** (source of truth, git-friendly). The graph build also writes a compiled index:

| File | Role |
|------|------|
| `.fxmind/memory/*.md` | Topic knowledge (edit / review in PRs) |
| `.fxmind/knowledge-graph.json` | Query graph |
| `.fxmind/memory-index.json` | Fast frontmatter index + validation summary |

```bash
fxmind memory validate          # schema + missing paths + duplicates
fxmind memory validate --strict # exit 1 on errors (CI-friendly)
fxmind graph                    # rebuild graph + memory-index.json
fxmind corrections list         # skill-improvement backlog
fxmind corrections export       # markdown digest → edit fivem-development/<category>.md
fxmind corrections promote <id> # mark as applied to the skill
```

Required frontmatter: `topic`, `updated`, `lang: en-compact`, plus non-empty `paths[]` or `triggers[]`.

**Best-practices layout:** one skill (`fivem-development`) + split refs (`communication.md`, `performance.md`, `architecture.md`, `style.md`, `security.md`, `api.md`) routed from `SKILL.md`. Index with stable § links: `best-practices.md`. Corrections categories map 1:1 to those files — do not create separate Cursor skills per topic.
---

## Hooks (Cursor)

Installed automatically with `fxmind -y` for Cursor. Skip with `--no-hooks`.

Also installs `.cursor/rules/fxmind-auto-task.mdc` (`alwaysApply`) and adds session paths to `.gitignore`.

| Hook | Role |
|------|------|
| `gate-guard` | Auto-starts Task; blocks edits until A/B; blocks Write to gates JSON |
| `drift-watcher` | Detects stale memories; rebuilds graph after learn |
| `learn-prompt` | Reminds to finish Gate C |
| `pre-commit` (git) | Blocks commit when a memory references a deleted file |

```bash
fxmind hooks install       # hooks + MCP + auto-task rule + gitignore
fxmind hooks uninstall
```

Useful env vars: `FXMIND_AUTO_TASK=0`, `FXMIND_GATE_WARN=1`, `FXMIND_GRAPH_NO_AUTO=1`.

---

## MCP server

Install globally once (all agents use the `fxmind-mcp` binary on `PATH`):

```bash
npm install -g github:fx-mind/fxmind
```

Wired automatically into `.cursor/mcp.json` (and agent equivalents). **Portable** config — safe to commit:

**Cursor / Claude / Gemini** (`.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "fxmind": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${env:APPDATA}/npm/node_modules/fxmind/scripts/mcp-server.js"
      ],
      "env": {
        "FXMIND_TARGET": "${workspaceFolder}"
      }
    }
  }
}
```

On macOS/Linux the install writes `"command": "fxmind-mcp"` (no `args`) instead — npm shims work there.

**Windows note:** do **not** use bare `fxmind-mcp` as `command` in Cursor — spawn fails with ENOENT and Cursor **auto-disables** the server. The `node` + script form above is required.

**Important (Cursor):** after install, keep **fxmind** **enabled** under **Settings → Tools & MCP**. If the toggle flips off again, check MCP Logs (Output panel) — usually a spawn crash.

**OpenCode** (`opencode.json` at project root):

```json
{
  "mcp": {
    "fxmind": {
      "type": "local",
      "command": ["fxmind-mcp"],
      "enabled": true
    }
  }
}
```

The global binary avoids `npx.cmd` → `cmd.exe` on Windows, which breaks MCP spawn under Git Bash / MSYS2.

| MCP tool | Action |
|----------|--------|
| `fxmind_query` | Graph search with token budget |
| `fxmind_graph` | Rebuild graph + `memory-index.json` |
| `fxmind_list_memories` | List topic memories |
| `fxmind_validate_memories` | Schema + path checks + duplicates |
| `fxmind_drift_check` | Memories referencing a file |
| `fxmind_start_task` | Begin Task session |
| `fxmind_gate_status` / `fxmind_record_gate` | Gates START/A/B/V/C (session only) |
| `fxmind_record_correction` / `fxmind_list_corrections` | Skill-improvement backlog |
| `fxmind_fivem_status` / `fxmind_fivem_cmd` / `fxmind_fivem_console_tail` | Local FXServer RCON + log tail (dev) |

Skip with `--no-mcp`. Refresh with `fxmind hooks install` or `fxmind --update -y`. Restart the MCP client after changes.

### Local FiveM RCON (dev, no txAdmin)

One-shot setup (agent or human):

```bash
fxmind fivem install
```

Writes `rcon_password` into cfg, `.vscode/fivem-start.ps1` (console tee), `tasks.json`, and gitignore. Idempotent. MCP: `fxmind_fivem_install`.

| Need | How |
|------|-----|
| First-time / missing password | `fxmind fivem install` then restart **fivem-start** |
| `ensure` / `restart` | UDP RCON (`fxmind fivem ensure` / MCP) |
| Full terminal log for `tail` / MCP | Task **fivem-start** tees stdout → `.fxmind/fivem-console.log` |

```bash
fxmind fivem ensure my_resource
fxmind fivem tail
```

Allowlisted RCON: `ensure`, `start`, `stop`, `restart`, `refresh`, `status`, `resmon`.

### MySQL (oxmysql cfg)

Connection is read from `mysql_connection_string` in `dev/dev.cfg` / `server.cfg` (or `FXMIND_MYSQL_URL`).

| MCP | CLI | Role |
|-----|-----|------|
| `fxmind_db_status` | `fxmind db status` | Config check (no password leaked) |
| `fxmind_db_explore` | `fxmind db explore` | List tables |
| `fxmind_db_schema` | `fxmind db schema [table]` | Columns / tables |
| `fxmind_db_sample` | `fxmind db sample <table>` | Sample rows |
| `fxmind_db_analyze` | `fxmind db analyze <table>` | Status + COUNT + indexes |
| `fxmind_db_query` | `fxmind db query "…"` | SQL; **DELETE/DROP/TRUNCATE need user approval** (`approvedByUser` / `--yes`) |


---

## FiveM pack

| Pack | Contents | Skills repo |
|------|----------|-------------|
| `fivem` | vRP, QBCore, Qbox, ESX, NUI | [fivem-skill](https://github.com/proelias7/fivem-skill) |

Scaffold a new pack: `fxmind pack new <id>`.

---

## Advanced

**Global store** — per-project memories under `~/.fxmind/projects/<id>/`, with cross-project links in the graph:

```bash
fxmind --global-store -y
fxmind global list
```

**Reproducible installs** — `fxmind -y` writes `.fxmind/packs.lock.json` with pinned skill-repo commits.

**Local development** (monorepo):

```bash
cd fxmind && npm test
node scripts/install.js --target ../my-project --pack fivem -y
```

---

## Why use fxmind

- **Fewer tokens** — slim router; modes and audit matrix load only when needed
- **Faster** — graph, query, and drift run in Node (seconds, not minutes in chat)
- **One memory** — a single `.fxmind/memory/` shared by every agent on the team

---

## License

MIT — **[proelias7](https://github.com/proelias7)**
