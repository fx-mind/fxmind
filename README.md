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
| **`/fxmind`** | Chat command: learn, audit, query the graph, run tasks |
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
| `/fxmind task <request>` | **Main workflow** — analyze, load memories, implement, post-task learn |
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
├── memory/              # topic memories
├── skills/              # pack skills
├── modes/               # /fxmind mode specs (loaded on demand)
├── knowledge-graph.json # graph for query/path/explain
├── packs.json           # installed packs manifest
└── fxmind.md            # /fxmind command router
```

---

## Task mode & Gates

Use `/fxmind task` for code changes. With Cursor hooks installed, three gates apply:

1. **Gate A** — plan (scope, risks, memories) before editing
2. **Gate B** — load 3–5 relevant memories
3. **Gate C** — review whether new knowledge should be learned

Markers live in `.fxmind/fxmind-gates.json`. The `gate-guard` hook blocks edits until A/B are complete.

---

## Hooks (Cursor)

Installed automatically with `fxmind -y` for Cursor. Skip with `--no-hooks`.

| Hook | Role |
|------|------|
| `gate-guard` | Blocks edits without Gates A/B |
| `drift-watcher` | Detects stale memories; rebuilds graph after `/fxmind learn` |
| `learn-prompt` | Reminds to finish Gate C at end of task |
| `pre-commit` (git) | Blocks commit when a memory references a deleted file |

```bash
fxmind hooks install       # install/update hooks + MCP
fxmind hooks uninstall     # remove hooks
```

Useful env vars: `FXMIND_GATE_WARN=1` (warn only, don't block), `FXMIND_GRAPH_NO_AUTO=1` (disable auto graph rebuild).

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
      "command": "fxmind-mcp"
    }
  }
}
```

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
| `fxmind_graph` | Rebuild the graph |
| `fxmind_list_memories` | List topic memories |
| `fxmind_drift_check` | Memories referencing a file |
| `fxmind_gate_status` / `fxmind_record_gate` | Gates A/B/C |

Skip with `--no-mcp`. Refresh with `fxmind hooks install` or `fxmind --update -y`. Restart the MCP client after changes.

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
