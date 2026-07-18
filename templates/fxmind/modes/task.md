# fxmind — Mode: Task

**Invoke (any of these):**
- Natural language — user asks to change code/config (**default**; no slash command needed)
- `/fxmind task <implementation request>`
- Legacy `/fxmind <request>` without `task`

Use Task mode when the user asks to **make, create, implement, fix, adjust, refactor, add, remove, wire, migrate, or change code/config**. Load only the memory needed, then learn from the completed work.

> **Gates are session state enforced by Cursor `gate-guard`.** Record them **only** via MCP (`fxmind_start_task`, `fxmind_record_gate`). Never Write `.fxmind/fxmind-gates.json` — the hook blocks direct edits. On the first code edit without an active task, the hook auto-starts Task (disable with `FXMIND_AUTO_TASK=0`).
>
> **MCP required:** if the `fxmind` MCP server is disabled/unavailable, **STOP** — do not edit code or “aplicar correção sem MCP”. Tell the user: *Cursor → Settings → Tools & MCP → enable **fxmind*** (Windows: if it auto-disables, run `fxmind hooks install` so `.cursor/mcp.json` uses `node` + script). Retry after MCP tools appear.

## Start task

Call MCP **`fxmind_start_task`** (or `fxmind_record_gate` with `gate: "START"`). If this tool is missing → MCP is off; ask the user to enable it.

## Gate A — show analysis (before any edit)

Post a block with: **Goal**, **Scope** (resource/files), **Topics**, **Risks**, **Memory plan** (candidate topics from index/graph, or "no index match").

Output:
```
🛑 GATE A COMPLETE — GOAL: <one-line>, SCOPE: <files>, TOPICS: <list>, RISKS: <list or none>
```
Then call **`fxmind_record_gate`** with `gate: "A"`.

## Gate B — load memory (before any edit)

1. Prefer MCP **`fxmind_query`** with the goal/question (budget ~1500).
2. Else read `.fxmind/memory/_index.md` / `.fxmind/memory-index.json`; load **3–5** relevant `.fxmind/memory/<topic>.md`.
3. Read `.fxmind/reference.md` if present.

Output:
```
🛑 GATE B COMPLETE — MEMORIES LOADED: <list or none>, REFERENCE: <loaded/absent>, GRAPH: <used/fallback>
```
Then call **`fxmind_record_gate`** with `gate: "B"` and a short `note` listing memories.

## Implement

1. Read the real code files needed.
2. Follow patterns from memories, `.fxmind/reference.md`, and skills.
3. Edit only as required; prefer existing helpers/events/framework APIs.
4. Validate with focused lints/grep where practical.
5. Do not edit memory files during implementation.
6. **Reload on FXServer yourself** (do not ask the user):
   - If RCON is not configured (`passwordSet: false`), call MCP **`fxmind_fivem_install`** (or `fxmind fivem install`) once, then ask the user to restart the **fivem-start** task.
   - After changing a FiveM resource that needs a console reload, call MCP **`fxmind_fivem_cmd`** with `ensure <resource>` (or `restart <resource>` / `refresh` when appropriate).
   - Then call **`fxmind_fivem_console_tail`** and check for script errors.
   - If RCON/status fails after install (`timeout`, server down): report once and continue — never tell the user to run `ensure` / `restart` manually when MCP tools exist.
   - Skip only when the edit cannot affect a running resource (docs-only, memory-only, unused path).
7. **Live debug loop** (when behavior is unclear or a fix needs runtime proof):
   - Add temporary tagged `print("[fxmind:shops]", ...)`.
   - `ensure`/`restart` via **`fxmind_fivem_cmd`** (prefer RCON over typing in the FXServer task terminal — the tee pipe may not accept stdin).
   - Ask the user **only** to reproduce in-game — never paste logs.
   - Call **`fxmind_fivem_console_tail`** — last lines of `.fxmind/fivem-console.log` (mirrored by `.vscode/fivem-start.ps1` inside Cursor).
   - Fix → ensure → tail again. Remove debug prints before finishing.

**Ask when context is missing** (stop before editing): target resource when multiple matches, expected behavior, permission/job rules, client vs server vs NUI responsibility, destructive migrations, money/inventory/permission/vehicle/XP/ban behavior. Do not ask for trivial details resolvable from code/memories.

**Selective retrieval:** memories are a routing cache, not a bulk dump. Canonical matching: lowercase, strip accents, singular/plural (`grupos`→`grupo`), compare slug/triggers/aliases/path fragments/symbols. Never load all memories "to be safe".

## User corrections — ask to save (mandatory)

When the user **corrects** your work — wrong resource/file, wrong event/API, wrong client/server split, wrong permission rule, "não é assim", redirect to another approach, or any fix driven by the user after you implemented incorrectly — **do not silently continue**.

After applying the correction, **ask whether to save it** before moving on:

1. **Cursor Agent:** use **AskQuestion** with options like:
   - **Salvar em Pitfalls** — append to `.fxmind/memory/<topic>.md` (project pattern)
   - **Salvar correção para skill** — call MCP **`fxmind_record_correction`** → `.fxmind/corrections/` (skill backlog)
   - **Salvar nos dois** — Pitfalls + corrections
   - **Salvar como tópico novo** — create/update a distinct memory file
   - **Não salvar** — one-off fix
2. **Other agents:** ask the same in chat with numbered options.

**When asking**, summarize in one line what would be saved and suggest topic slug + correction category (`architecture` | `communication` | `security` | `performance` | `style` | `api`).

**If user chooses Pitfalls / topic:** update memory at Gate C (compact English).
**If user chooses skill correction:** call `fxmind_record_correction` with `{ title, category, bad, good, rule, commit? }` immediately (do not wait for Gate C).

**If user chooses não salvar:** continue; at Gate C state "mudança pontual" unless other reusable knowledge emerged.

**Triggers for this prompt** (non-exhaustive): user says you used the wrong file/resource/event; user re-explains how the project works; user rejects your approach and gives the correct one; user fixes your logic in follow-up messages.

Do **not** ask on trivial nitpicks (typo, formatting only) or when the user already said "salva na memória" / "registra em Pitfalls" / "salva correção".

## Gate C — post-task learning (before final reply)

Review whether reusable knowledge was learned (flows, events, menu structure, conventions) — **including any correction the user approved saving**. If yes → update/create `.fxmind/memory/<topic>.md` + `_index.md`. If no → state "mudança pontual".

After writing memory: call **`fxmind_validate_memories`** and fix any errors (required frontmatter, paths/triggers).

Output:
```
🛑 GATE C COMPLETE — LEARNING: <memory created: path / updated: path / none — mudança pontual>
```
Then call **`fxmind_record_gate`** with `gate: "C"` (clears `taskActive`). If memory changed, suggest `/fxmind graph` or call `fxmind_graph`.

## Memory write rules (only when Gate C qualifies)

1. Read `_index.md` and candidate `memory/<topic>.md` before writing.
2. Canonicalize the topic; update existing if same domain, create only for distinct domain.
3. Use `memory.template.md` structure, compact English, `lang: en-compact`, ~25–60 lines.
4. Frontmatter arrays (`resources`, `paths`, `events`, `exports`, `symbols`, `triggers`) — grep-confirmed literals only; `confidence: extracted`. **paths[] or triggers[] must be non-empty.**
5. Update `_index.md` (create from `memory-index.template.md` if missing); update one row under `## Memórias por tópico` in `.fxmind/reference.md` if it exists.

Do **not** create memory for: tiny style changes, one-off bug fixes with no reusable flow, guesses without repo evidence, duplicated topics.

## Reply

Reply in the user's language with the implementation summary and validation. If memory changed, add `Memória criada: .fxmind/memory/<topic>.md` or `Memória atualizada: ...` and suggest `/fxmind graph`. If no reusable knowledge, omit memory noise.

## Task rules

- Optimize context: read the index first, then only relevant memories.
- Never invent paths, events, APIs, permissions, or framework behavior.
- Memory writes only after code work is complete and only for verified reusable knowledge.
- Preserve unrelated user changes in the working tree.
- **Never Write `.fxmind/fxmind-gates.json`** — MCP only.
- **Never ask the user to `ensure` / `restart` a resource** — use `fxmind_fivem_cmd`.
- **Never ask the user to paste FXServer console logs** — use `fxmind_fivem_console_tail` (`.fxmind/fivem-console.log` from the in-Cursor `fivem-start.ps1` tee).
