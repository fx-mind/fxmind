# fxmind — Mode: Task

**Invoke:** natural language code/config change · `/fxmind task <request>` · legacy `/fxmind <request>`

Load memory → implement → **verify** → learn. Verify details live in **`.fxmind/modes/task-verify.md`** (read after Implement / before Gate C).

> **Gates = MCP only** (`fxmind_start_task`, `fxmind_record_gate`). Never Write `.fxmind/fxmind-gates.json`. MCP off → STOP and ask user to enable **fxmind**.
>
> Do not narrate step numbers to the user.

## 1. Classify (one shape)

| CLASS | Signal | Action |
|-------|--------|--------|
| **question** | why / what do you think / diagnosis only | Findings + 1 recommendation. **No edits.** Leave Task. |
| **analyze-only** | analyze/analisar/review/investigar/diagnosticar/propor/planear **without** apply/fix/implement | Investigate → report plan → **AskQuestion**. Edit only after approval. |
| **plan-first** | ambiguous scope, irreversible/outward action, or user asked for a plan | Gate A(+B) → plan → **STOP** for approval. |
| **trivial** | ALL: 1 file, ~<10 lines, no new behavior, no search needed | `fxmind_start_task` with `trivial: true` (auto A+B) → edit → read **task-verify** (V) → C usually "mudança pontual". |
| **task** | fix / build / change / make | Full pipeline below. |

Tie-breaks (order): (1) question beats edit; (2) analyze-only / plan-first beat task; (3) "analisa e corrige" = **task** after short analysis; (4) unsure analyze vs task → **analyze-only**; (5) mixed why+fix = **task** that also answers why.

Never re-litigate decisions the user already made. If the answer is only your inference: say so (low-confidence) — do not costume rigor.

## 2. Start

- Full task: **`fxmind_start_task`** `{ note }` then Gate A → B.
- Trivial: **`fxmind_start_task`** `{ note, trivial: true }` (records A+B with note `trivial`) — still output short chat markers, then edit.

## 3. Gate A (before any edit)

Post: **CLASS**, **Goal**, **Done** (observable + how to verify), **Scope**, **Topics/Risks/Memory plan**, and when behavior will change:

`INTENT: code does <X>; check/task expects <Y>; spec (memory/reference/README) says <Z>`

Open memory/reference/docs to fill Z. Disagreement → surface it; do not silently pick a side. Authority: explicit user > memory/reference/spec > tests > current code. "Make tests pass" ≠ intent.

FiveM example:
`INTENT: code does TriggerClientEvent(..., -1); task expects fix broadcast; spec (memory/broadcast + performance.md) says never manager:* to -1`

**FiveM tasks** (resource Lua/NUI/fxmanifest in scope): read `.fxmind/skills/fivem-development/quality-gates.md` and add a **QUALITY** design block:

```
QUALITY:
  endpoints: <new/changed + type>
  payload:   <KB estimate; list = metadata only>
  cache:     <server §2.1 | client §2.1.1 | none>
  validate:  <§5.3 per mutation>
  rate-limit:<SafeEvent | SetCooldown | both>
  fan-out:   <source | -1 | cerberus | none>
```

**Refactor tasks** (same resource, behavior preservation): add `INVARIANTS: <what must not change>` to Gate A.

```
🛑 GATE A COMPLETE — CLASS: <class>, GOAL: <one-line>, DONE: <criterion + verify>, SCOPE: <files>, TOPICS: <list>, RISKS: <list or none>, QUALITY: <filled|n/a — non-FiveM>
```
→ `fxmind_record_gate` `A`.

**analyze-only / plan-first:** after A (+ B if needed) → deliver findings/plan → AskQuestion → stop.

## 4. Gate B (before any edit)

1. Prefer **`fxmind_query`** (~1500). If it fails because the graph is missing/stale, call **`fxmind_graph`** with `{ updateHtml: false }` and retry; else fall back to `_index` + 3–5 memories + `reference.md`.
2. **Graph engineering (FiveM tasks):** load memories matching Gate A TOPICS; scan `.fxmind/corrections/` for entries whose category matches the domain (`performance`, `security`, `communication`, `architecture`, `style` — maps 1:1 to pack skill files). Read matching correction files before Implement.
3. Primary sources for APIs/natives not opened this session.
4. Evidence budget: 2 lookup rounds; 3rd needs a reason.

```
🛑 GATE B COMPLETE — MEMORIES LOADED: <list or none>, REFERENCE: <loaded/absent>, GRAPH: <used/fallback>, CORRECTIONS: <n loaded | none>
```
→ `fxmind_record_gate` `B` (+ note).

## 5. Implement

1. Orient (list/glob) then read real files; smallest correct change; match style.
2. Surprise → say it, update Done/Scope; do not force the old plan.
3. Max **3** fix→verify retries → hand-back.
4. No commit/push; no weaken checks; no secrets; no silent scope expand; no deps unless asked.
4b. **Scratch files:** prefer OS temp or in-repo test paths under `resources/`. If you must use `.fxmind/tmp/`, delete that folder before **Gate C** (or when abandoning the task). Never commit `tmp/` — it is gitignored session scratch, not fxmind data.
5. Outward AUTH for push/deploy-remote/publish/send. **ensure/restart = local verify, no AUTH.**
6. FiveM (local dev only): call `fxmind_fivem_status` first. If `available: true` → after resource edit use `fxmind_fivem_cmd` + `fxmind_fivem_console_tail`. For NUI bugs: **`fxmind_fivem_nui_wire` → dump → `fxmind_fivem_nui_unwire`** (agent configures and must remove before Gate C; never leave probe). If `installed: false` or `passwordSet: false` → `fxmind_fivem_install` once (writes dev/dev.cfg + nui-bridge), ask restart **fivem-start**, stop. If MCP tools missing or `available: false` → skip automation; ask user to run ensure/restart manually. Live debug: tagged prints → ensure (when available) → user reproduces → tail / nui_dump or pasted console → fix → remove prints / unwire.
7. Ask when missing: target resource, expected behavior, job/permission, client vs server vs NUI, destructive/money/inventory rules. One pointed question with your recommended reading when only the user can settle.

Selective memory: never load all. Canonicalize slugs (accents, singular/plural).

## 5b. Diff self-review (after Implement, before Gate V)

**FiveM tasks:** read `.fxmind/skills/fivem-development/quality-gates.md` → run the **self-review loop** (enumerate artifacts in diff → checklist E1–E8 / §5.3 / §1.6 / §2.1.1 → clean code C1–C5 → fix failures). Max **2** self-review cycles.

Output the **REVIEW** and **PARITY** lines (see `task-verify.md`) — they are required inside the Gate V marker. Do not skip self-review and jump straight to Gate V.

## 6. Gate V + Judge

**Read `.fxmind/modes/task-verify.md` now.** Run Gate V (`fxmind_record_gate` `V`). Run Judge when that file says it is mandatory.

## 7. User corrections

After applying a user correction, AskQuestion: Pitfalls / `fxmind_record_correction` / both / new topic / don't save. Skip typos-only or when they already asked to save.

## 8. Gate C

Requires V (MCP enforces). Learn reusable knowledge → memory + validate; else "mudança pontual".

Before recording Gate C: remove `.fxmind/tmp/` if you created scratch files there (shell `rm -rf .fxmind/tmp` or delete files). Hooks also prune `tmp` after Gate C or when no task is active.

**Quality pitfalls:** if self-review found a reusable gap not yet in the pack, call **`fxmind_record_correction`** (category = matching skill file: `performance`, `security`, etc.) in addition to user-correction flow.

```
🛑 GATE C COMPLETE — LEARNING: <created/updated path | none — mudança pontual>, CORRECTION: <recorded|none>
```
→ `fxmind_record_gate` `C`.

Memory rules: template + `lang: en-compact`; grep-confirmed frontmatter; `paths[]` or `triggers[]` non-empty; no memory for one-off/guess/dupe.

## Rules

- Never invent paths/events/APIs/permissions.
- When FiveM MCP is available (`fxmind_fivem_status.available: true`), use `fxmind_fivem_cmd` / `fxmind_fivem_console_tail` — do not ask the user. When MCP or FXServer is unavailable, skip and ask the user to run ensure/restart manually (paste console output only if Gate V needs it).
- Pack minimum evidence (when present): `.fxmind/minimum-evidence.md` before acting in that domain.
