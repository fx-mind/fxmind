<p align="center">
  <img src="https://avatars.githubusercontent.com/u/296747387?s=200&v=4" alt="fxmind logo" width="120" />
</p>

# fxmind — shared project memory for AI agents

**fxmind** installs shared project memory (`.fxmind/`), a `/fxmind` command workflow, and optional domain **knowledge packs** into your repo. Works with **Cursor**, **Claude Code**, **Codex**, **Gemini CLI**, **OpenCode**, and **VS Code Copilot**.

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
| **2D graph** | Visual topic map (`fxmind graph`) |
| **Hooks** (Cursor) | Task gates + stale-memory detection |
| **MCP** | Programmatic tools (`fxmind_query`, `fxmind_graph`, …) |
| **OpenCode subagents** | `explore` / `reader` / `general` / `scout` under `.opencode/agents/` |

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
| `/fxmind graph` | Rebuild the 2D knowledge graph |
| `/fxmind memory health` | Verify memories against the codebase |
| `/fxmind update` | Prompts to run `fxmind --update -y` in the terminal |

Gemini uses `/fxmind:task`, `/fxmind:learn`, etc. VS Code Copilot uses `/fxmind` (prompt file) plus the `.github/skills/fxmind` skill.

### In the terminal

```bash
fxmind -y                  # install (Cursor + fivem pack by default)
fxmind --update -y         # refresh templates/skills/hooks/MCP/fivem-start (keeps memories)
fxmind graph               # open 2D graph in the browser
fxmind hooks status        # show hooks + MCP status
fxmind -h                  # all options
```

**Agents** — `--cursor`, `--claude`, `--gemini`, `--opencode`, `--codex`, `--copilot`, or `--agent cursor,copilot -y`.

**Packs** — `--pack fivem`, `--no-packs` (core only), `--all-packs`.

---

## Project layout

```
.fxmind/
├── fxmind.md            # /fxmind command router
├── packs.json           # installed packs manifest
├── packs.lock.json      # reproducible pack pins
├── memory/              # topic memories (source of truth)
├── modes/               # /fxmind mode specs (loaded on demand)
├── skills/              # pack skills
├── audits/              # reports + procedure.md
├── corrections/         # skill-improvement backlog
├── templates/           # memory/report skeletons (read-only)
├── policy/              # failure-modes, topic-catalog, minimum-evidence
├── graph/               # knowledge-graph.json/html + memory-index.json
├── reports/             # generated human reports (memory-health)
└── state/               # session/runtime (gitignored)
```

Session-only (gitignored): `.fxmind/state/` — gates, metrics, RCON, logs, graph cache, `tmp/`.

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

Prove claims: **`/fxmind judge`**. Behavioral map: `.fxmind/policy/failure-modes.md`. FiveM evidence: `.fxmind/policy/minimum-evidence.md`.

**Gates are session state (MCP only).** Agents must not Write `.fxmind/state/fxmind-gates.json` — `gate-guard` blocks it. The file is gitignored (ephemeral).

`/fxmind task <request>` still works as an explicit shortcut.

---

## Memory quality

Memories stay as **Markdown** (source of truth, git-friendly). The graph build also writes a compiled index:

| File | Role |
|------|------|
| `.fxmind/memory/*.md` | Topic knowledge (edit / review in PRs) |
| `.fxmind/graph/knowledge-graph.json` | Query graph (agents use this + `memory-index.json`) |
| `.fxmind/graph/knowledge-graph.html` | Optional 2D visualization for humans (`fxmind graph`) |
| `.fxmind/graph/memory-index.json` | Fast frontmatter index + validation summary |
| `.fxmind/state/graph-cache.json` | Local build cache (gitignored) |
| `.fxmind/state/tmp/` | Ephemeral agent scratch (gitignored; removed when task inactive or Gate C done) |

**Agents and MCP tools depend on JSON + index, not HTML.** Automatic rebuilds (after learn, drift-watcher, session start, stale `fxmind_query`) refresh JSON + index only unless you run `fxmind graph` (browser) or pass `updateHtml: true` / set `FXMIND_GRAPH_UPDATE_HTML=1`.

```bash
fxmind memory validate          # schema + missing paths + duplicates
fxmind memory validate --strict # exit 1 on errors (CI-friendly)
fxmind graph                    # rebuild JSON + HTML + memory-index.json (opens browser)
fxmind graph --no-open --no-html  # JSON + index only (same as automatic rebuilds)
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
| `drift-watcher` | Detects stale memories; rebuilds JSON graph after memory edits |
| `learn-prompt` | Reminds to finish Gate C (once; skipped on user stop/abort) |
| `graph-freshness` | On session start, rebuilds stale `knowledge-graph.json` + index |
| `update-notifier` | On session start, prompts agent to offer `fxmind --update -y` when a newer version exists |
| `pre-commit` (git) | Blocks commit when a staged (non-deleted) file is missing but still listed in a memory `paths[]` |

```bash
fxmind hooks install       # hooks + MCP + auto-task rule + gitignore
fxmind hooks uninstall
```

Useful env vars: `FXMIND_AUTO_TASK=0`, `FXMIND_GATE_WARN=1`, `FXMIND_GRAPH_NO_AUTO=1`, `FXMIND_NO_UPDATE_CHECK=1`.

---

## MCP server

Install globally once (all agents use the `fxmind-mcp` binary on `PATH`):

```bash
npm install -g github:fx-mind/fxmind
```

Wired automatically into `.cursor/mcp.json`, `.vscode/mcp.json` (VS Code Copilot), and other agent equivalents. **Portable** config — safe to commit:

**Cursor / Claude / Gemini** (`.cursor/mcp.json`, `.mcp.json`, etc.):

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

**VS Code Copilot** (`.vscode/mcp.json` — top-level `servers`, not `mcpServers`):

```json
{
  "servers": {
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

`--opencode` also installs subagents under `.opencode/agents/` (`explore`, `reader`, `general`, `scout`) and `.opencode/instructions/delegate-io.md`. They override OpenCode’s built-in explore/general/scout with fxmind-aware prompts (`.fxmind/memory/`, pack skills). `reader` is fxmind-only. Models are not hardcoded — set them in `opencode.json` if you want faster subagent models. Restart OpenCode after install.

The global binary avoids `npx.cmd` → `cmd.exe` on Windows, which breaks MCP spawn under Git Bash / MSYS2.

| MCP tool | Action |
|----------|--------|
| `fxmind_query` | Graph search with token budget |
| `fxmind_graph` | Rebuild `knowledge-graph.json` + `memory-index.json` (optional HTML via `updateHtml`) |
| `fxmind_check_update` | Compare local vs GitHub fxmind version (read-only) |
| `fxmind_list_memories` | List topic memories |
| `fxmind_validate_memories` | Schema + path checks + duplicates |
| `fxmind_drift_check` | Memories referencing a file |
| `fxmind_start_task` | Begin Task session |
| `fxmind_gate_status` / `fxmind_record_gate` | Gates START/A/B/V/C (session only) |
| `fxmind_record_correction` / `fxmind_list_corrections` | Skill-improvement backlog |
| `fxmind_fivem_status` / `fxmind_fivem_cmd` / `fxmind_fivem_console_tail` | Local FXServer RCON + log tail (dev). **Status probes reachability** — use cmd/tail only when `available: true`; otherwise ask user to run console commands manually. |
| `fxmind_fivem_nui_wire` / `fxmind_fivem_nui_dump` / `fxmind_fivem_nui_unwire` | Agent TEMP-wires a NUI resource, dumps structured state, then **must unwire**. Better than screenshots. |

Skip with `--no-mcp`. Refresh with `fxmind --update -y` (also refreshes hooks + fivem-start) or `fxmind hooks install`. Restart the MCP client after changes.

### Auto update check (Cursor)

When Cursor hooks are installed, `sessionStart` runs `.cursor/hooks/update-notifier.js` (at most one network check per 24h). If a newer fxmind version or project layout is available, the agent receives context to **tell you in chat** and ask (AskQuestion) whether to run `fxmind --update -y`. Memories are preserved; the agent runs the CLI only after you confirm.

Opt out: set `"autoUpdateCheck": false` in `.fxmind/packs.json`, or `FXMIND_NO_UPDATE_CHECK=1`.

### Local FiveM RCON (dev, no txAdmin)

Dev-only: RCON works only after **`fxmind fivem install`**, which writes **`dev/dev.cfg`** and `.fxmind/state/rcon.json` (never production `server.cfg`). Commands require a running **fivem-start** console that responds over UDP.

One-shot setup (agent or human):

```bash
fxmind fivem install
```

Writes `rcon_password` into **dev/dev.cfg**, `.vscode/fivem-start.ps1` (interactive terminal), `tasks.json`, and gitignore. Idempotent. MCP: `fxmind_fivem_install`. Also refreshed automatically by `fxmind --update -y` when the fivem pack is installed or markers already exist.

| Need | How |
|------|-----|
| First-time / RCON not installed | `fxmind fivem install` then restart **fivem-start** |
| `fxmind_fivem_status.available: false` | Start fivem-start or run console commands manually — do not claim ensure succeeded |
| `ensure` / `restart` | UDP RCON (`fxmind fivem ensure` / MCP) |
| Full log for `tail` / MCP | RCON exchanges → `.fxmind/state/fivem-console.log`; optional `server-debug.log` |
| NUI vision for agents | `fxmind fivem nui-dump` / MCP `fxmind_fivem_nui_dump` → `.fxmind/state/nui-dump.json` |

`fivem install` also copies **`fxmind-nui-bridge`** and sets `fxmind_nui_dump_path`. Agents should **auto-wire** (no manual script edits):

```bash
fxmind fivem nui-wire my_nui
fxmind fivem ensure fxmind-nui-bridge
fxmind fivem ensure my_nui
fxmind fivem nui-dump --resource my_nui
fxmind fivem nui-unwire
```

Allowlisted RCON: `ensure`, `start`, `stop`, `restart`, `refresh`, `status`, `resmon`, `fxmind_nui_dump`.

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
