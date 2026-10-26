# fxmind — Mode: Learn

Create **small, source-grounded atomic facts** linked to code symbols, not one large memory file per topic. Learn mode is read-only for project source code.

## Scope

- `/fxmind learn list`: show known topics and atom counts using `fxmind_query` or the atomic index; legacy `.fxmind/memory/_index.md` is an optional historical reference.
- `/fxmind learn <topic>`: investigate only the requested topic and produce a handful of independent, searchable facts.
- If this is a general question, do not run learn or gates. Use `fxmind_query` instead.

## Procedure

1. Read the preloaded FXMIND context and the smallest relevant topic hints in `.fxmind/policy/topic-catalog.md`. Call `fxmind_query` first to identify existing facts and avoid duplicates.
2. Search only the matching source files and symbols. Prefer bounded FXMIND discovery tools; use grep only when coverage is missing. Never invent paths, names, events or behavior.
3. Extract one behavior, event mapping, permission check, pitfall, rule or decision per fact. Make text concise and self-contained; do not copy secrets or whole files.
4. For **each** fact, call MCP `fxmind_graph` with:
   ```json
   {
     "updateHtml": false,
     "addFact": {
       "topic": "garages",
       "kind": "behavior",
       "text": "The storage handler verifies player id and plate before storing a vehicle.",
       "path": "resources/example/garages/server.lua",
       "evidence": "if not userId or not plate then return false end",
       "symbols": ["canStoreVehicle"]
     }
   }
   ```
   This is a shape example, **not** a claim about the current repository. Supply actual source-relative path and an **exact substring** found in that source file. If evidence cannot be verified, **do not save** the fact.
5. The MCP records evidence, file hash and line in a global per-project store and rebuilds the atomic graph. It deduplicates and ignores stale facts when their source changes. A later `fxmind_query` retrieves just the matching snippets.
6. If MCP is unavailable, do not manufacture a local memory file. Explain the limitation and use `fxmind memory index` when CLI access resumes.

## Constraints

- Never modify Lua/JS code during learn.
- Do not automatically create or extend broad `.fxmind/memory/<topic>.md` files. Existing topic Markdown remains compatible and is migrated non-destructively.
- Prefer separate facts for event registration, handler, command, config and return values; add `symbols`/`events` only when confirmed.
- Do not expose secrets, credentials or personal data in facts, evidence, replies or external AI prompts.
- Optional JEV assists routing; it never determines fact truth or blocks verified local writes.
- Respond in the user's language with learned fact count, topic, linked sources and skipped evidence if any.
