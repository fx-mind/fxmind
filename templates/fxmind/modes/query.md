# fxmind — Mode: Query

Answer a question by **traversing the topic knowledge graph** and loading only relevant memories. Read-only — do not edit code or memory files.

## MCP fast path

If the fxmind MCP server is available, call **`fxmind_query`** with `{ question, dfs?, budget? }` — it does BFS/DFS + budget-aware memory loading in Node and returns ready-to-use memory content. Skip Steps 1–4 below and answer from the tool result.

## Manual path

Parse `$ARGUMENTS` after `query`: question text in quotes (required), `--dfs` (depth-first trace), `--budget N` (default **1500**).

### Step 1 — Load graph

1. Read `.fxmind/knowledge-graph.json` if it exists.
2. If missing → extract `GRAPH_DATA` from `.fxmind/knowledge-graph.html`.
3. If neither exists → tell user to run `/fxmind learn <topic>` then `/fxmind graph`; stop.

### Step 2 — Vocabulary expansion (required)

Build vocabulary from graph learned nodes only: `id`, `name`, `triggers`, `paths`, `events`, `exports`, `resources`. Select up to **12 tokens from this vocabulary** that match the question intent. Pick only tokens present in the graph vocabulary; do not invent synonyms. If no tokens match → say plainly; stop.

Print: `Query expanded to: [token1, token2, ...]`

### Step 3 — Traversal

| Mode | When |
|------|------|
| **BFS** (default) | Broad context — neighbors layer by layer, depth 3 |
| **DFS** (`--dfs`) | Trace a specific chain — depth max 6 |

1. Score learned nodes by token overlap; take top 1–3 start nodes.
2. Traverse using link priority: `event-flow` > `shared-resource` > `shared-path` > `shared-symbol` > `cross-mention` > `domain-related`.
3. Catalog nodes are never traversal targets.

### Step 4 — Load memories (budget-aware)

For each traversed learned node, load `memory/<topic>.md`:

| Depth | Load |
|-------|------|
| Hub (degree ≥ 3) | Full memory, up to 40 lines |
| BFS depth 1 | `Files` + `Recipe` |
| BFS depth 2+ | Frontmatter + `Files` only |
| DFS chain | Full memory for nodes on the path |

Stop when `--budget` token estimate is reached (`chars / 4`).

### Step 5 — Answer

Reply in **user's language**. Cite memory paths and link types used. Quote events/paths from memories only. If graph lacks enough information → say so; suggest `/fxmind learn <topic>` or `/fxmind graph`.

## Query rules

- **Do not** scan full codebase beyond loaded memory files.
- **Do not** edit any files.
- **Do not** invent edges or events not in graph/memories.
