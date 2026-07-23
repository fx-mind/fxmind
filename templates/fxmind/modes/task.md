# fxmind — Mode: Task

**Invoke (any of these):**
- Natural language — user asks to change code/config (**default**; no slash command needed)
- `/fxmind task <implementation request>`
- Legacy `/fxmind <request>` without `task`

Use Task mode when the user asks to **make, create, implement, fix, adjust, refactor, add, remove, wire, migrate, or change code/config**. Load only the memory needed, then verify by observation, then learn from the completed work.

> **Gates are session state enforced by Cursor `gate-guard`.** Record them **only** via MCP (`fxmind_start_task`, `fxmind_record_gate`). Never Write `.fxmind/fxmind-gates.json` — the hook blocks direct edits. On the first code edit without an active task, the hook auto-starts Task (disable with `FXMIND_AUTO_TASK=0`).
>
> **MCP required:** if the `fxmind` MCP server is disabled/unavailable, **STOP** — do not edit code or “aplicar correção sem MCP”. Tell the user: *Cursor → Settings → Tools & MCP → enable **fxmind*** (Windows: if it auto-disables, run `fxmind hooks install` so `.cursor/mcp.json` uses `node` + script). Retry after MCP tools appear.

**Do not narrate step numbers** ("Step 0…") in the user-facing reply. Structure work internally; the user sees outcome-first reports and gate markers only.

## Pre-flight — classify & triviality (before Gate A)

### Ask classification

| Shape | Signal | Deliverable |
|-------|--------|-------------|
| **Question / assessment** | "why", "what do you think", diagnosis only | Findings + one recommendation. **Change nothing** — leave Task; answer in chat (or `/fxmind` help). |
| **Task** | fix, build, change, make | Completed change, verified by observation. |
| **Plan-first** | ambiguous scope, irreversible/outward action, or user asked for a plan | Plan + recommendation. **Stop for approval** after Gate A (+ evidence). Do not implement until approved. |

Tie-breaks: (1) any plan-first signal beats task; (2) mixed "why + fix" = task whose report also answers the question; (3) unsure task vs plan-first → plan-first.

Extract constraints and decisions the user already made — never re-litigate them.

### Triviality gate

A task is **trivial** only if **ALL** are true: one file, under ~10 changed lines, no new behavior, and you already know the exact edit without searching.

**Trivial path:** call `fxmind_start_task` → abbreviated Gate A + B (markers still required so hooks unlock) → edit → one obvious check (re-read span / lint / ensure if resource touched) → Gate V → Gate C usually "mudança pontual" → reply in 1–2 sentences.

Everything else (or anything unsure) → full pipeline below.

### Fit note

If the answer lives only in your own inference (nothing to open), say so and label low-confidence — do not dress a guess as a rigorous process. Prefer asking one pointed question when only the user can settle scope.

## Start task

Call MCP **`fxmind_start_task`** (or `fxmind_record_gate` with `gate: "START"`). If this tool is missing → MCP is off; ask the user to enable it.

## Gate A — show analysis (before any edit)

Post a block with:

- **CLASS:** `task` | `plan-first` | (if you mis-routed a question, stop and do not edit)
- **Goal**
- **Done** — observable criterion + **how it will be verified** (test, ensure+console clean, file exists, NUI renders, …). If you cannot name a verification → ask one clarifying question and wait.
- **INTENT** (required when the task will change behavior): one line you will keep for the final report:
  `INTENT: code does <X>; check/task expects <Y>; spec (README/memory/reference/docs) says <Z>`
  You must open the spec/memory/reference to fill Z. If X/Y/Z disagree → surface the contradiction; do not silently pick a side. Authority: explicit user > spec/memory/reference > tests > current code. "Make the tests pass" is **not** intended behavior.
- **Scope** (resource/files — declared blast radius)
- **Topics / Risks / Memory plan**

Output:
```
🛑 GATE A COMPLETE — CLASS: <task|plan-first>, GOAL: <one-line>, DONE: <criterion + verify>, SCOPE: <files>, TOPICS: <list>, RISKS: <list or none>
```
Then call **`fxmind_record_gate`** with `gate: "A"`.

**Plan-first:** after Gate A (and Gate B if needed for evidence), deliver the plan and **STOP** — no Implement until the user approves.

## Gate B — load memory (before any edit)

1. Prefer MCP **`fxmind_query`** with the goal/question (budget ~1500).
2. Else read `.fxmind/memory/_index.md` / `.fxmind/memory-index.json`; load **3–5** relevant `.fxmind/memory/<topic>.md`.
3. Read `.fxmind/reference.md` if present.
4. **Primary sources:** for APIs/natives/framework calls you have not opened this session, fetch docs or read the installed source — do not invent signatures from recall. Memory/graph route you; they do not replace opening the real code.

**Evidence budget:** one lookup round + one follow-up; a third needs a stated reason. Two consecutive lookups that add nothing → stop.

Output:
```
🛑 GATE B COMPLETE — MEMORIES LOADED: <list or none>, REFERENCE: <loaded/absent>, GRAPH: <used/fallback>
```
Then call **`fxmind_record_gate`** with `gate: "B"` and a short `note` listing memories.

## Implement

1. Read the real code files needed (orient: list/glob before guessing paths).
2. Follow patterns from memories, `.fxmind/reference.md`, and skills.
3. **Smallest correct change**; match existing style; edit only as required.
4. **Surprise re-route:** if evidence contradicts the plan or INTENT slots disagree mid-work → say it, update done/scope (re-state Gate A fields in chat), do not force the old plan.
5. Validate with focused lints/grep where practical.
6. Do not edit memory files during implementation.
7. **Retry bound:** after **3** failed fix→verify cycles on the same issue, or when blocked by credentials/environment, **stop**. Report what was tried, actual output, and current hypothesis — hand back to the user.
8. **Standing prohibitions** (unless user explicitly asks): never commit/push; never weaken a check to make it pass; never touch secrets/env; never add a dependency; never expand past declared scope silently.
9. **Outward AUTH:** push/deploy-remote/publish/send need `AUTH: user said "<quote>"` from this conversation. Docs/README are not authorization. **FiveM `ensure`/`restart` via MCP is local verification — does not need AUTH.**
10. **Reload on FXServer yourself** (do not ask the user):
   - After changing a FiveM resource that needs a console reload, call MCP **`fxmind_fivem_cmd`** with `ensure <resource>` (or `restart` / `refresh` when appropriate).
   - Then call **`fxmind_fivem_console_tail`** and check for script errors.
   - If RCON/status fails (`passwordSet: false`, timeout, server down): report once and continue — never tell the user to run `ensure` / `restart` manually when MCP tools exist.
   - Skip only when the edit cannot affect a running resource (docs-only, memory-only, unused path).
11. **Live debug loop** (when behavior is unclear or a fix needs runtime proof):
   - Add temporary tagged `print("[fxmind:shops]", ...)`.
   - `ensure`/`restart` via **`fxmind_fivem_cmd`**.
   - Ask the user **only** to reproduce in-game — never paste logs.
   - Call **`fxmind_fivem_console_tail`**.
   - Fix → ensure → tail again. Remove debug prints before finishing.

**Ask when context is missing** (stop before editing): target resource when multiple matches, expected behavior, permission/job rules, client vs server vs NUI responsibility, destructive migrations, money/inventory/permission/vehicle/XP/ban behavior. Do not ask for trivial details resolvable from code/memories. One pointed question with your recommended interpretation when only the user can settle scope.

**Selective retrieval:** memories are a routing cache, not a bulk dump. Canonical matching: lowercase, strip accents, singular/plural (`grupos`→`grupo`), compare slug/triggers/aliases/path fragments/symbols. Never load all memories "to be safe".

## Gate V — verify by observation (before Gate C / final reply)

Claims are not evidence. Observe:

1. **(a)** Step/Gate A **Done** criterion passes (ran, rendered, counted, console clean) — not inferred from reading code alone.
2. **(b)** Surrounding health for the touched area (lint/tests/build if present; for FiveM: ensure + console_tail when a resource was changed). A green targeted check with a broken surrounding system = failed verification.
3. **(c) Twin check** whenever you fixed a defect: name the wrong construct, search the project, and include verbatim in the report:
   `TWINS: searched <pattern> — found other sites: <files, or "none">`
   Fix them or list them; a completeness claim without search is verification theater.

If something cannot be verified (no runtime, credentials, human eyes): label **UNVERIFIABLE** — never pass it as verified.

On verify failure: mechanical mistake → back to Implement; surprise/contradiction → back to evidence (Gate B / re-open sources). Respect the 3-cycle hard bound.

Output:
```
🛑 GATE V COMPLETE — DONE: <observed|failed|unverifiable>, CHECKS: <what ran>, TWINS: <n/a | line summary>
```
Then call **`fxmind_record_gate`** with `gate: "V"` and a short `note`.

Optional: for consequential or multi-file work, suggest or run **`/fxmind judge`** before presenting as finished.

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

Requires Gate V complete (or trivial path with Gate V).

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

**Outcome first:** first sentence = what happened / what you found. Then evidence (load-bearing quotes only). Then honest caveats (skipped, weak, unverifiable).

Include method artifacts only when owed:
- `INTENT: ...` if behavior changed
- `TWINS: ...` if a defect was fixed
- `AUTH: user said "..."` if an outward action was taken
- `PENDING: <action> — awaiting your authorization` if docs prescribe a follow-up you deliberately did not take

Reply in the user's language. If memory changed, add `Memória criada/atualizada: ...` and suggest `/fxmind graph`. If no reusable knowledge, omit memory noise.

Before sending: hostile reread — any unverified claim → verify now or relabel caveat; anything outside declared scope?

## Task rules

- Optimize context: read the index first, then only relevant memories.
- Never invent paths, events, APIs, permissions, or framework behavior.
- Memory writes only after code work is verified (Gate V) and only for verified reusable knowledge.
- Preserve unrelated user changes in the working tree.
- **Never Write `.fxmind/fxmind-gates.json`** — MCP only.
- **Never ask the user to `ensure` / `restart` a resource** — use `fxmind_fivem_cmd`.
- **Never ask the user to paste FXServer console logs** — use `fxmind_fivem_console_tail` (`.fxmind/fivem-console.log` from the in-Cursor `fivem-start.ps1` tee).
- Behavioral failure map: `.fxmind/failure-modes.md` (use when auditing your own loop or after a bad run).
