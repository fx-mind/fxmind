# fxmind — Mode: Path

Find the **shortest path** between two learned topics. Read-only.

Parse `$ARGUMENTS` after `path`: `<topic-a> <topic-b>` (e.g. `path craft inventario`).

### Step 1 — Load graph

Read `.fxmind/knowledge-graph.json` (fallback: extract `GRAPH_DATA` from `.fxmind/knowledge-graph.html`). If neither exists → tell user to run `/fxmind graph`; stop.

### Step 2 — Match nodes

Match each argument to best learned node by: exact `id`, canonical slug, `name`, or `triggers` overlap. If either node not found → list closest learned matches; stop.

### Step 3 — Shortest path

Unweighted shortest path over learned-node links only. When multiple equal-length paths exist, prefer paths with more `event-flow` and `shared-resource` hops.

### Step 4 — Explain

Reply in **user's language**:

1. Hop list: `craft --event-flow--> inventario --shared-resource--> webhook`
2. What each hop means (read linked memory files).
3. Key events/paths cited from memories.

Suggest `/fxmind explain <topic>` or `/fxmind query "<follow-up>"` for deeper exploration.

### Path rules

- **Do not** edit files or invent connections not in the graph.
