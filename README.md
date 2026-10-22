<p align="center">
  <img src="https://i.postimg.cc/Z565rzH8/Chat-GPT-Image-11-09-2026-00-01-28.png" alt="fxmind logo" width="120" />
</p>

# fxmind — shared project memory for AI agents

**fxmind** installs shared project memory (`.fxmind/`), a `/fxmind` command workflow, and optional domain **knowledge packs** into your repo. Works with **Cursor**, **Claude Code**, **Codex**, **Gemini CLI**, **OpenCode**, and **VS Code Copilot**.

The first pack is **FiveM** (vRP, QBCore, Qbox, ESX, NUI). More domains can be added under `packs/`.

**Optional Jev integration:** semantic task classification and optional memory ordering, disabled by default. See [docs/jev-optional.md](docs/jev-optional.md) for private API key configuration and testing.

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
| **Web panel** | Local control plane (`fxmind painel`) — projects, memories, query, gates, inbox |
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
| `/fxmind teach <name>` | Turn a task that worked into a **playbook** (surgical steps for a repeated request) |
| `/fxmind query "…"` | Search the knowledge graph |
| `/fxmind create <resource>` | New resource: design (`.fxmind/designs/`) → approval → build per slice |
| `/fxmind refactor <resource>` | Rewrite a bad resource: contract inventory → target design → slices with parity checks |
| `/fxmind audit [scope]` | Code audit (diagnosis only) → `.fxmind/audits/` |
| `/fxmind graph` | Rebuild the 2D knowledge graph |
| `/fxmind painel` | Open the local web panel (inbox + agent chat) |
| `/fxmind memory health` | Verify memories against the codebase |
| `/fxmind update` | Prompts to run `fxmind --update -y` in the terminal |

Gemini uses `/fxmind:task`, `/fxmind:learn`, etc. VS Code Copilot uses `/fxmind` (prompt file) plus the `.github/skills/fxmind` skill.

### In the terminal

```bash
fxmind -y                  # install (Cursor + fivem pack by default)
fxmind --update -y         # refresh only files that differ from this CLI (keeps memories)
fxmind graph               # open 2D graph in the browser
fxmind painel              # local web panel (UI + API)
fxmind hooks status        # show hooks + MCP status
fxmind -h                  # all options
```

**Agents** — `--cursor`, `--claude`, `--gemini`, `--opencode`, `--codex`, `--copilot`, or `--agent cursor,copilot -y`.

**Packs** — `--pack fivem`, `--no-packs` (core only), `--all-packs`.

---

## Token-efficient context

- **Retrieval** (`fxmind_query`, panel preload, Claude hook) ranks memories with PT↔EN domain synonyms, drops filler words, matches whole terms and weighs each term by rarity, so a word every memory shares ("player") never decides the ranking. Over-budget memories load only the matching sections; graph neighbours are listed, not loaded.
- **Claude Code preload** — `fxmind -y --claude` registers `fxmind context --hook` as a `UserPromptSubmit` hook in `.claude/settings.json`: relevant memories are injected before the agent answers (nothing when none match). `FXMIND_PRELOAD=0` disables it, `FXMIND_PRELOAD_BUDGET` sets the budget (default 1200). Try it with `fxmind context "garagem nao abre"`.
- **MCP tool groups** — FXMIND advertises its complete tool catalog (40 tools as of this release) on every machine, regardless of installed packs or credentials. Unconfigured tools still validate prerequisites and fail safely, and `FXMIND_MCP_READONLY=1` still hides/blocks mutating tools. Set `FXMIND_MCP_TOOLS=auto` to opt into the old project-aware filtered list, or use a group list (`fivem,db,panel`) to show only selected groups.
- **Add a provider without changing packs** — In an existing project, `fxmind --opencode -y`, `fxmind --cursor -y` or `fxmind --agent cursor,claude -y` updates only requested providers, their MCP settings and necessary hooks/commands. Existing packs, lockfiles, memories and unrelated providers are left untouched. The interactive installer reuses saved pack/agent/skill selections. Use `--pack`, `--no-packs` or `--update` for deliberate pack changes.
- **Read-only mode** — `FXMIND_MCP_READONLY=1` exposes only tools that never write (memory, source search, DB reads, server status). `fxmind_db_query` then accepts a single `SELECT`/`SHOW`/`DESCRIBE`/`EXPLAIN` and runs it inside a `READ ONLY` transaction. Used by the PortSpace FiveHub staff chat, which reaches this server through the Portspace Agent. For extra safety point `FXMIND_MYSQL_URL` at a MySQL user with only `SELECT`.

## S3 image storage (MCP)

The existing `fxmind-mcp` server includes these image tools. The package now requires **Node >=20.9** for the maintained S3 SDK and Sharp releases:

| Tool | Purpose |
|------|---------|
| `fxmind_storage_status` | Inspect configuration without a network request or returning credentials |
| `fxmind_image_resize` | Save a resized/compressed image to a new local file; never overwrite the source or an existing output |
| `fxmind_storage_upload_image` | Optimize in memory, then upload to an S3-compatible bucket |

Create `.fxmind/storage.json` in the **target project** (the installer adds it to `.gitignore`):

```json
{
  "endpoint": "https://s3.example.com",
  "region": "us-east-1",
  "bucket": "project-assets",
  "forcePathStyle": true,
  "prefix": "images",
  "publicBaseUrl": "https://cdn.example.com",
  "maxWidth": 2048,
  "maxHeight": 2048,
  "maxBytes": 5242880
}
```

For AWS S3, omit `endpoint` and use `forcePathStyle: false`. Custom endpoints default to path-style addressing; set it to false if the provider requires virtual-host addressing. `publicBaseUrl` is optional and must point at the bucket's public root (including any bucket path). Without it, uploads return `publicUrl: null` plus the object key/S3 URI; the tool never makes a bucket public or changes ACLs.

Keep credentials in a **`.env` file at the target project root** (`FXMIND_TARGET`, not the fxmind package's installation directory). Copy the shipped `.env.example` or use:

```dotenv
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
# AWS_SESSION_TOKEN=temporary-session-token
FXMIND_S3_ENDPOINT=https://s3.example.com
FXMIND_S3_REGION=us-east-1
FXMIND_S3_BUCKET=project-assets
FXMIND_S3_PUBLIC_URL=https://cdn.example.com
```

The storage tools read `.env` on each call, including quoted values and comments, without changing the MCP process environment. Credentials never appear in status/results. The installer ignores `.env`; only `.env.example` belongs in Git. Existing process environment values take precedence over `.env`, which takes precedence over `.fxmind/storage.json`. Both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are required when supplying explicit credentials; `AWS_SESSION_TOKEN` is optional. Without an explicit pair, the AWS SDK's standard process/profile/IAM chain remains available.

Non-secret configuration can also use `FXMIND_S3_PREFIX` and `FXMIND_S3_FORCE_PATH_STYLE` (`true`/`false`) in `.env`. `AWS_REGION`/`AWS_DEFAULT_REGION` are region fallbacks. `.env` edits apply on the next call; restart the MCP only when changing its process environment.

Resize locally to an **exact** resolution, cropping to cover the target:

```json
{"path":"assets/original.png","outputPath":"assets/banner.png","width":1920,"height":1080,"fit":"cover","format":"png","maxBytes":1048576}
```

Upload with the same processing in one call (no temporary output file):

```json
{"path":"assets/original.png","key":"banners/home.png","width":1920,"height":1080,"fit":"cover","format":"png","maxBytes":1048576}
```

The result includes actual `width`, `height`, `bytes`, `contentType`, original dimensions/size and the uploaded `key` (here `images/banners/home.png`). Omit `key` for a unique name. Existing objects are refused with `If-None-Match: *`; use `overwrite: true` only for intentional replacement. Providers must honor conditional PutObject requests; failures are never retried without the condition.

Defaults: fit **inside** 2048x2048 without enlargement, lossless PNG, at most **5 MiB**. Project `maxWidth`/`maxHeight` set the default bounding box; explicit dimensions override it. `cover` crops, `contain` pads transparently (white for JPEG), and `fill` stretches to an exact size; each requires both dimensions and may enlarge small inputs. With `inside`, dimensions preserve aspect ratio and can differ from the request. JPEG/WebP quality is reduced down to 40 if needed, without changing dimensions; PNG stays lossless. If the byte limit still cannot be met, the operation fails **before writing/uploading**. Upload `maxBytes` may lower, but cannot exceed, the project limit.

Inputs: local raster images, at most 50 MiB / 40 megapixels; animated/multipage images and SVG/PDF are rejected. Outputs: WebP, PNG or JPEG, at most 8192 pixels per axis / 40 megapixels. Orientation is applied and metadata stripped; originals are preserved. The upload tool appears in the complete catalog by default, but rejects uploads until an S3 bucket and credentials are configured. Set `FXMIND_MCP_TOOLS=auto` to hide it when unavailable, or use `FXMIND_MCP_TOOLS=storage` to select that group. Status and local resize are available unless restricted by read-only mode. `FXMIND_MCP_READONLY=1` hides and blocks both write tools, including direct calls.

Implementation follows [Sharp resize semantics](https://sharp.pixelplumbing.com/api-resize/) and [S3 PutObject](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/PutObjectCommand/).

## Task kinds and playbooks

Memories describe a topic; **playbooks** (`.fxmind/playbooks/<id>.md`, committed) are the procedure for a request you repeat — e.g. *cadastrar skin de arma*: which file, which anchor, what to insert, how to verify.

````md
---
id: add-weapon-skin
kind: config
triggers: [cadastrar skin de arma, adicionar skin]
memories: [skins-armas]        # their Pitfalls are appended automatically
status: draft                  # becomes verified after one task closes Gate C with it
---
Inputs:
- skinId — key in ConfigWeapons (= skinid in DB)
Steps:
1. `resources/boxes/weapons.lua` @ `ConfigWeapons.Items = {` — add the entry under general or police
   ```lua
   ['{{skinId}}'] = { meta = { weaponModel = '...', originalModel = '...' } },
   ```
Verify:
- ensure boxes; equip the skin in the UI
````

- **Anchors, not line numbers.** Each step names a file and a text anchor (`{{name}}` = variable part). The current line is resolved when the playbook loads; a missing file/anchor marks it *stale* and the agent falls back to memories.
- **Detection is deterministic** (no LLM): `fxmind context --hook` matches the request against `triggers[]` (PT/EN, action synonyms). A match injects the playbook — files, current lines, snippets, verify, memory pitfalls — instead of memories.
- **Every task has a kind** — `config`, `fix`, `mechanic`, `create` — guessed by the hook and confirmed at Gate A (`fxmind_start_task { kind, playbook }`). Without a playbook the kind picks how memories load:

| kind | Loads | Budget |
|------|-------|--------|
| config | memory Files + Recipe | 1200 |
| fix | Files + Pitfalls, symbols from the error | 1500 |
| mechanic | whole flow + graph neighbours (dfs) | 2200 |
| create | `modes/create.md` flow | 1200 |

- A **verified** playbook auto-completes Gates A/B (V and C still required); a draft one keeps them manual. UI tasks never auto-complete.

```bash
fxmind playbooks list                     # id, kind, status, uses
fxmind playbooks check [id]               # format, files and anchors resolve
fxmind playbooks match "cadastrar skin"   # kind + playbook the hook would pick
fxmind playbooks show <id>                # rendered with current lines
```

MCP: `fxmind_playbook` (list / match / get / check). `FXMIND_PRELOAD_BUDGET` overrides the per-kind budget.

## Web panel

Local control plane (projects, memories, graph query, gates, PortSpace inbox stub):

```bash
fxmind painel                  # http://127.0.0.1:3847/chat
```

The panel build is generated automatically during `fxmind -y` installation,
when `fxmind --update -y` actually changes project files, or the package install lifecycle. The manual command
`npm run build:web` is only needed when developing the workspace UI.

PortSpace/Trello connection is stored in `~/.fxmind/panel.json`.

**PortSpace card lifecycle** — a PortSpace demand (from the inbox or the demand queue)
is claimed before its thread starts (card assigned to the key owner and moved to the
dev column; a card someone else took is skipped). Pushing the thread completes the card
with the pushed commit, branch and repo URL (moved to the test column). Deleting an
undelivered thread releases the card back to its source column. The result of the last
call is kept in the thread's `cardSync`.

`/fxmind painel` in the agent chat runs `fxmind painel` and can **keep that chat as host** (no API key). The panel binds to the nearest `.fxmind/` from cwd when started.

Dev (monorepo): `npm run dev` from the workspace root — Vite on :5173, API on :3847 (`fxmind serve --api-only`).

---

## Project layout

```
.fxmind/
├── fxmind.md            # /fxmind command router
├── packs.json           # installed packs + cliVersion stamp
├── packs.lock.json      # reproducible pack pins
├── memory/              # topic memories (source of truth)
├── modes/               # /fxmind mode specs (loaded on demand)
├── skills/              # pack skills
├── audits/              # reports + procedure.md
├── designs/             # create/refactor designs (contract + decisions; commit)
├── corrections/         # skill-improvement backlog
├── templates/           # memory/report skeletons (read-only)
├── policy/              # failure-modes, topic-catalog, minimum-evidence
├── graph/               # derived locally (gitignored; rebuild from memory/)
├── reports/             # generated human reports (memory-health)
└── state/               # session/runtime (gitignored)
```

Commit these: `.fxmind/memory/` (topic knowledge), `.fxmind/corrections/` (skill feed) and `.fxmind/designs/` (resource designs).

**FiveM principles** (`.fxmind/policy/fivem-principles.md`, fivem pack): binding rules with IDs — recipient scope, minimal payload, chunked big data, no periodic fan-out, client-side sync via statebags, anti-flood, no DB in hot paths, dynamic sleep, minimal readable code. Task, create, refactor and audit cite the IDs; Gate V `review` checks them against the diff.

Generated / session-only (gitignored, rebuilt locally): `.fxmind/graph/` — `knowledge-graph.json/html`, `memory-index.json` — and `.fxmind/state/` — gates, metrics, RCON, logs, graph cache, `tmp/`.

**Corrections backlog:** human fixes of agent mistakes, separate from topic memories. Export with `fxmind corrections export` → edit the matching `fivem-development/<category>.md`.
---

## Task mode & Gates

Gate V now requires structured `evidence` (`files`, `review`, `checks`) through
`fxmind_record_gate`; a note-only call no longer completes verification. Prioritize
lint/syntax, typecheck, code quality and focused tests. Check kinds include `lint`
and `typecheck`. Record `evidence.ui: { changed, reason }` from the actual diff.
Only actual rendered-content/layout/style/interaction changes require browser
interactions, visual/console observations and a screenshot/trace. Unchanged UI
context, backend-only work, comments/tooling and non-visual refactors do not require
opening the interface. The reviewer validates this assessment against the diff;
changing it after review invalidates the review. `ui: true` at task start is a planning hint.
Failed or blocked checks keep V incomplete; C rejects code changed since V. Lua files also pass a deterministic lexical-scope check. Gate V automatically runs a fresh read-only reviewer against the original goal and actual source/diff; do not launch a separate review first. Gate V accepts only a strict `VERIFIED` artifact bound to the current file fingerprints and UI assessment.
See `templates/fxmind/modes/task-verify.md` for the contract.

Quick mode reduces overhead without bypassing quality checks. `fxmind_search`
provides bounded literal source search when the memory graph lacks coverage.
Graph-query budgets bound memory text using an approximate characters/4 estimate;
truncated memories include their source path for targeted follow-up reading.

Update the package **and installed project templates/hooks together**, then restart
the agent/MCP session. Existing V markers without structured evidence must be recorded
again. Gate V now combines evidence structure/freshness with deterministic Lua lexical-scope checks and, on meaningful tasks, an independent reviewer artifact. Runtime/browser observations still cannot be cryptographically authenticated; Judge remains the stronger proof path when risk requires it.

Just ask for the change in natural language — Task mode runs **automatically** (no `/fxmind task` required). With Cursor hooks installed:

1. **Classify** — `question` / `analyze-only` / `plan-first` / `trivial` / `task` (see `.fxmind/modes/task.md`)
2. **Start** — MCP `fxmind_start_task` (`trivial: true` auto-completes A+B)
3. **Gate A** — CLASS, Done+verify, INTENT if needed → `fxmind_record_gate` A
4. **Gate B** — load memories → `fxmind_record_gate` B
5. **Implement** — surgical edits; max 3 fix→verify retries
6. **Independent review** — when required, call `fxmind_independent_review`; fix `REFUTED` / `VERIFIED WITH CAVEATS`, then rerun until strict `VERIFIED`
7. **Gate V** — read `.fxmind/modes/task-verify.md`; deterministic checks + observed Done (+ TWINS) → `fxmind_record_gate` V (**required before C**)
8. **Judge** — when task-verify says mandatory (blast radius / money-permission / INTENT)
9. **Gate C** — post-task learn → `fxmind_record_gate` C (clears session)

Prove claims: **`/fxmind judge`**. Behavioral map: `.fxmind/policy/failure-modes.md`. FiveM evidence: `.fxmind/policy/minimum-evidence.md`.

**Gates and independent-review artifacts are managed session state (MCP only).** Agents must not write `.fxmind/state/fxmind-gates.json`, `.fxmind/state/sessions/`, or `.fxmind/state/reviews/` directly — `gate-guard` blocks them. The state tree is gitignored (ephemeral).

`/fxmind task <request>` still works as an explicit shortcut.

---

## Memory quality

Memories stay as **Markdown** (source of truth, git-friendly). The graph build also writes a compiled index:

| File | Role |
|------|------|
| `.fxmind/memory/*.md` | Topic knowledge (edit / review in PRs; this is what syncs via git) |
| `.fxmind/graph/knowledge-graph.json` | Query graph — rebuilt locally, gitignored |
| `.fxmind/graph/knowledge-graph.html` | Optional 2D visualization — rebuilt locally, gitignored |
| `.fxmind/graph/memory-index.json` | Fast frontmatter index — rebuilt locally, gitignored |
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
| `fxmind_query` | Memory search (PT/EN) with token budget; returns matching sections as Markdown |
| `fxmind_graph` | Rebuild `knowledge-graph.json` + `memory-index.json` (optional HTML via `updateHtml`) |
| `fxmind_check_update` | Compare local vs GitHub fxmind version (read-only) |
| `fxmind_list_memories` | List topic memories |
| `fxmind_playbook` | List / match / get / check playbooks (surgical steps for repeated tasks) |
| `fxmind_validate_memories` | Schema + path checks + duplicates |
| `fxmind_drift_check` | Memories referencing a file |
| `fxmind_start_task` | Begin Task session |
| `fxmind_gate_status` / `fxmind_record_gate` | Gates START/A/B/V/C (session only) |
| `fxmind_independent_review` | Fresh read-only reviewer; stores a strict verdict tied to the current task files/fingerprint. Required before V for Lua, multi-file and normal fix/mechanic/create tasks. |
| `fxmind_record_correction` / `fxmind_list_corrections` | Skill-improvement backlog |
| `fxmind_fivem_status` / `fxmind_fivem_cmd` / `fxmind_fivem_console_tail` | Local FXServer RCON + log tail (dev). **Status probes reachability** — use cmd/tail only when `available: true`; otherwise ask user to run console commands manually. |
| `fxmind_fivem_nui_wire` / `fxmind_fivem_nui_dump` / `fxmind_fivem_nui_unwire` | Agent TEMP-wires a NUI resource, dumps structured state, then **must unwire**. Better than screenshots. |

Skip with `--no-mcp`. Refresh with `fxmind --update -y` (copies only files that differ from this CLI, then stamps `cliVersion` in `.fxmind/packs.json`) or `fxmind hooks install`. If everything already matches, it prints `Already up to date` and exits. Restart the MCP client after changes.

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

`fivem install` / `--update` do **not** create **`fxmind-nui-bridge`**. It is copied (and `ensure` + `fxmind_nui_dump_path` added to the cfg) only when an agent is asked to inspect a NUI and runs `nui-wire` (MCP `fxmind_fivem_nui_wire`). No manual script edits:

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

Development remains the default. For production, put the connection string in the **target project's `.env`** (already ignored by Git):

```dotenv
FXMIND_MYSQL_PRODUCTION_URL="mysql://agent_readonly:password@db.example.com:3306/production"
```

URL-encode special characters in username/password (e.g. `@` becomes `%40`). The oxmysql `server=...;uid=...;password=...;database=...` format is also accepted. Use a database account with read permissions. All six DB tools accept `environment: "dev" | "production"`; omitting it preserves the current dev connection. Production uses only its explicit `.env`/process setting, never falls back to dev, and always runs inside a **READ ONLY transaction**. SQL writes are blocked even with `approvedByUser: true` or CLI `--yes`. Status/results identify the environment and omit the password. No persistent environment switch is made.

```json
{"environment":"production","query":"SELECT * FROM users LIMIT 10"}
```

```bash
fxmind db status --environment production
fxmind db query "SELECT * FROM users LIMIT 10" --environment production
```

The example JSON is for `fxmind_db_query`; `fxmind_db_status`/`explore` need only `environment`, while `schema`/`sample`/`analyze` also accept their usual `table_name`. The DB group is available when either dev or production is configured. `.env` is reread on each call, scoped to the target project; existing process variables take precedence. `FXMIND_MYSQL_URL` and `MYSQL_CONNECTION_STRING` can also be set in `.env` for dev.

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
