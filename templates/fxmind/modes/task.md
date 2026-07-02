# fxmind — Mode: Task

**Invoke:** `/fxmind task <implementation request>` (preferred). Legacy: `/fxmind <request>` without `task` still routes here.

Use Task mode when the user asks to **make, create, implement, fix, adjust, refactor, add, remove, wire, migrate, or change code/config**. Load only the memory needed, then learn from the completed work.

> **Gates are enforced by the Cursor `gate-guard` hook via `.fxmind/fxmind-gates.json`.** Output the markers below; the hook blocks code edits until A & B are recorded. If hooks are not installed, the chat markers are the source of truth.

## Gate A — show analysis (before any edit)

Post a block with: **Goal**, **Scope** (resource/files), **Topics**, **Risks**, **Memory plan** (candidate topics from index/graph, or "no index match").

Output:
```
🛑 GATE A COMPLETE — GOAL: <one-line>, SCOPE: <files>, TOPICS: <list>, RISKS: <list or none>
```
Then record `gates.A.complete = true` in `.fxmind/fxmind-gates.json` (or call `fxmind_record_gate` MCP tool).

## Gate B — load memory (before any edit)

1. Read `.fxmind/memory/_index.md` (required every Task).
2. If `knowledge-graph.json` exists → graph-router (keywords → BFS depth 3, ~1500 token budget); else `.fxmind/topic-catalog.md` + index row matching.
3. Load **3–5** relevant `.fxmind/memory/<topic>.md` (or state none matched).
4. Read `.fxmind/reference.md` if present.

Output:
```
🛑 GATE B COMPLETE — MEMORIES LOADED: <list or none>, REFERENCE: <loaded/absent>, GRAPH: <used/fallback>
```
Then record `gates.B.complete = true` (hook now allows code edits).

## Implement

1. Read the real code files needed.
2. Follow patterns from memories, `.fxmind/reference.md`, and skills.
3. Edit only as required; prefer existing helpers/events/framework APIs.
4. Validate with focused lints/grep where practical.
5. Do not edit memory files during implementation.

**Ask when context is missing** (stop before editing): target resource when multiple matches, expected behavior, permission/job rules, client vs server vs NUI responsibility, destructive migrations, money/inventory/permission/vehicle/XP/ban behavior. Do not ask for trivial details resolvable from code/memories.

**Selective retrieval:** memories are a routing cache, not a bulk dump. Canonical matching: lowercase, strip accents, singular/plural (`grupos`→`grupo`), compare slug/triggers/aliases/path fragments/symbols. Never load all memories "to be safe".

## User corrections — ask to save (mandatory)

When the user **corrects** your work — wrong resource/file, wrong event/API, wrong client/server split, wrong permission rule, "não é assim", redirect to another approach, or any fix driven by the user after you implemented incorrectly — **do not silently continue**.

After applying the correction, **ask whether to save it as project memory** before moving on:

1. **Cursor Agent:** use **AskQuestion** with options like:
   - **Salvar em Pitfalls** — append to `.fxmind/memory/<topic>.md` (reusable project pattern)
   - **Salvar como tópico novo** — create/update a distinct memory file
   - **Não salvar** — one-off fix, no reusable knowledge
2. **Other agents:** ask the same in chat with numbered options.

**When asking**, summarize in one line what would be saved (e.g. "Garagem desativa em `config.lua`, not NUI") and suggest the topic slug (`garagem`, `admin`, …).

**If user chooses save:** note the Pitfall/Recipe update; apply it at **Gate C** (or immediately if the task is about to close). Use compact English in the memory file (`Pitfalls:` section for agent mistakes and correct approach).

**If user chooses não salvar:** continue implementation; at Gate C state "mudança pontual" unless other reusable knowledge emerged.

**Triggers for this prompt** (non-exhaustive): user says you used the wrong file/resource/event; user re-explains how the project works; user rejects your approach and gives the correct one; user fixes your logic in follow-up messages.

Do **not** ask on trivial nitpicks (typo, formatting only) or when the user already said "salva na memória" / "registra em Pitfalls".

## Gate C — post-task learning (before final reply)

Review whether reusable knowledge was learned (flows, events, menu structure, conventions) — **including any correction the user approved saving**. If yes → update/create `.fxmind/memory/<topic>.md` + `_index.md`. If no → state "mudança pontual".

Output:
```
🛑 GATE C COMPLETE — LEARNING: <memory created: path / updated: path / none — mudança pontual>
```
Then record `gates.C.complete = true` and set `taskActive: false` in `.fxmind/fxmind-gates.json`. If memory changed, suggest `/fxmind graph`.

## Memory write rules (only when Gate C qualifies)

1. Read `_index.md` and candidate `memory/<topic>.md` before writing.
2. Canonicalize the topic; update existing if same domain, create only for distinct domain.
3. Use `memory.template.md` structure, compact English, `lang: en-compact`, ~25–60 lines.
4. Frontmatter arrays (`resources`, `paths`, `events`, `exports`, `symbols`, `triggers`) — grep-confirmed literals only; `confidence: extracted`.
5. Update `_index.md` (create from `memory-index.template.md` if missing); update one row under `## Memórias por tópico` in `.fxmind/reference.md` if it exists.

Do **not** create memory for: tiny style changes, one-off bug fixes with no reusable flow, guesses without repo evidence, duplicated topics.

## Reply

Reply in the user's language with the implementation summary and validation. If memory changed, add `Memória criada: .fxmind/memory/<topic>.md` or `Memória atualizada: ...` and suggest `/fxmind graph`. If no reusable knowledge, omit memory noise.

## Task rules

- Optimize context: read the index first, then only relevant memories.
- Never invent paths, events, APIs, permissions, or framework behavior.
- Memory writes only after code work is complete and only for verified reusable knowledge.
- Preserve unrelated user changes in the working tree.
