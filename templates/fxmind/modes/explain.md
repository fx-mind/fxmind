# fxmind — Mode: Explain

Describe a **single topic node** and its connections. Read-only.

Parse `$ARGUMENTS` after `explain`: `<topic>` slug or name.

### Step 1 — Load graph and memory

1. Load `.fxmind/knowledge-graph.json` (fallback: extract `GRAPH_DATA` from `.fxmind/knowledge-graph.html`).
2. Load `.fxmind/memory/<topic>.md` for matched node.

### Step 2 — Match node

Find best learned node by exact `id`, canonical slug, `name`, or triggers. If not found → list learned topics from graph; stop.

### Step 3 — Output

Reply in **user's language** (3–5 sentences):

1. What this topic does (from memory `Recipe` / `Files`).
2. Direct neighbors grouped by link type.
3. Highest-value connection (`event-flow` first) and why it matters.
4. Degree (connection count) and resource scope.

Suggest `/fxmind path <this> <neighbor>` for trace if useful.

### Explain rules

- **Do not** edit files or invent edges.
