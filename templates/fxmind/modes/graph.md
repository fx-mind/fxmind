# fxmind — Mode: Graph

Build the 3D knowledge graph from `.fxmind/memory/` and open it.

**Always shell out to the Node builder** — do not assemble graph JSON in context. The builder is deterministic, faster, and cheaper than doing it by hand.

## Run

From the project root (where `.fxmind/` lives), run in the terminal:

```bash
fxmind graph                 # build + open 3D map in browser
fxmind graph --no-open       # write JSON/HTML only
fxmind graph --target ./proj # build for another project root
```

If `fxmind` is not installed globally:

```bash
npx --yes github:fx-mind/fxmind graph
```

The builder reads `.fxmind/memory/_index.md`, `.fxmind/memory/*.md`, and `.fxmind/topic-catalog.md`, then writes `.fxmind/knowledge-graph.json` + `.fxmind/knowledge-graph.html` (replacing only the `GRAPH_DATA` payload).

## Reply

Report what the builder printed (learned / catalog / links / tokens counts) and the paths to `knowledge-graph.json` and `knowledge-graph.html`. Remind the user to re-run after `/fxmind learn`, and that `/fxmind query` uses the graph for retrieval.

If `.fxmind/` is missing → tell the user to run `fxmind -y` first.

## Graph rules

- **Do not** assemble JSON manually, create helper scripts, or edit HTML/CSS/JS — the builder does all of it.
- **Do not** enter Task/Learn/Audit modes during `graph`.
- Shell is allowed only to run `fxmind graph` (and open the browser, which the CLI already does).
