# FXMIND Atomic Memory Graph (v2)

## Purpose

The FXMIND memory layer is no longer limited to a single `garages.md`-style document per system. It indexes source symbols, events, SQL table references, small Markdown statements, and independently verified Gate V/C evidence as individually addressable nodes.

Existing Markdown is **never deleted, renamed or rewritten** during migration. It remains indexed as historical notes. New facts are recorded individually, with verified code evidence, through `/fxmind learn` or `fxmind memory add`.

## Migration

Run from any initialized project:

```powershell
fxmind memory migrate
# or from another directory:
fxmind memory migrate --target "D:\Elias\FIVEM\ecco-base"
```

The command builds:
- `graph/atomic-index.json`: incremental source and Markdown fragments, metadata, evidence, and typed relationships.
- `graph/manual-atoms.json`: human/agent-learned, source-validated microfacts (created only when learning).
- `graph/verified-atoms.json`: independently verified Gate V/C symbols (created when verified).
- `graph/knowledge-graph.json`: the existing graph enriched with atomic nodes and links.
- `graph/memory-index.json`: the legacy compatibility index.

In global-store mode these generated records live under `~/.fxmind/projects/<project-id>/graph/`. Only minimal FXMIND configuration is necessary in the project; links/copies depend on the existing global-store installation. When global-store is not enabled, the index remains under `.fxmind/graph/`.

## Retrieval

`fxmind_query` first uses the atomic index. Only the best three relevant snippets fit into the configured token budget; each includes its exact source file, line (when known), resource and source hash. Named-code lookup, PT/EN domain synonyms and one-hop relationships work without opening the entire topic Markdown. Existing section-based retrieval and bounded source search remain fallbacks when the index lacks coverage.

A source's stored timestamp and size are checked periodically on queries; Gate V/C and graph rebuilds refresh affected files incrementally.

## Learning

After independently verified Gate V and C, FXMIND extracts source-exact records per discovered symbol and event in the changed files, stored in `graph/verified-atoms.json`. `/fxmind learn` stores one concise fact per verified claim through the existing `fxmind_graph` MCP tool's `addFact` argument in `graph/manual-atoms.json`; the CLI also supports `fxmind memory add --topic garages --text "..." --path "..." --evidence "..."`. Both require evidence exactly present in an existing source file. Deduplication and source SHA-256 checking keep stale claims out of the active graph. No broad snapshot is appended to `garages.md`.

Jev is optional and advisory: it can recommend whether to highlight a verified change, but cannot invent facts or stop local deterministic indexing. No source code or file paths are sent to Jev.

## Graph and panel

Each node has a stable ID, type, resource, evidence and source link. Relationships include `belongs-to`, `references-file`, `references-symbol` and `same-symbol`. The Memories panel shows a condensed overview by default; typing a resource or symbol reveals matching nodes plus nearby connections. Selecting a node shows the exact snippet, provenance and backlinks.

## Limits and safety

The local scanner targets source extensions (Lua, JS/TS, Python, SQL) and skips asset/build/dependency directories, large files, obvious secrets and symlinks. It never executes source code. The source index is bounded to 12,000 files, 350 KB per code file and 160 symbols per file. Index misses must fall back to existing source search, not imply an absence.

Existing Git status, storage mode, manually written notes and MCP tool count are unchanged.
