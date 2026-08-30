# FxMind tools only (panel — mandatory)

This project is optimized for **fxmind MCP** tools. The panel already attaches a context file with `fxmind_query` hits.

## Before any repo search

1. Read the attached **FxMind context file** (`--file`).
2. Call **`fxmind_query`** (~1500) and **`fxmind_list_memories`**.
3. **`fxmind_drift_check`** on files you will edit.
4. **Read** only at repository-relative paths from memories/query — use **`reader`** subagent for parallel reads.

## Forbidden (blocked in opencode.json)

- `grep` / `rg` / `find` / `findstr` / `Select-String`
- `ls` / `dir` / `Get-ChildItem` for repo discovery
- Repo-wide Glob (primary agent) — use `fxmind_query`
- Delegating **`explore`** when `fxmind_query` or the context file already has paths
- Absolute paths, wildcard directory reads, or `external_directory` for files inside the selected repository

## Allowed shell (when MCP cannot)

- `ensure` / `restart` → use **`fxmind_fivem_cmd`** when `fxmind_fivem_status.available`
- Targeted Read/Glob inside a path already named by fxmind memories

If fxmind MCP tools are missing → stop and ask the user to enable fxmind MCP.
