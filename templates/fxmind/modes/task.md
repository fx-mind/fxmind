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

```
🛑 GATE A COMPLETE — CLASS: <class>, GOAL: <one-line>, DONE: <criterion + verify>, SCOPE: <files>, TOPICS: <list>, RISKS: <list or none>
```
→ `fxmind_record_gate` `A`.

**analyze-only / plan-first:** after A (+ B if needed) → deliver findings/plan → AskQuestion → stop.

## 4. Gate B (before any edit)

1. Prefer `fxmind_query` (~1500). Else `_index` + 3–5 memories + `reference.md`.
2. Primary sources for APIs/natives not opened this session.
3. Evidence budget: 2 lookup rounds; 3rd needs a reason.

```
🛑 GATE B COMPLETE — MEMORIES LOADED: <list or none>, REFERENCE: <loaded/absent>, GRAPH: <used/fallback>
```
→ `fxmind_record_gate` `B` (+ note).

## 5. Implement

1. Orient (list/glob) then read real files; smallest correct change; match style.
2. Surprise → say it, update Done/Scope; do not force the old plan.
3. Max **3** fix→verify retries → hand-back.
4. No commit/push; no weaken checks; no secrets; no silent scope expand; no deps unless asked.
5. Outward AUTH for push/deploy-remote/publish/send. **ensure/restart = local verify, no AUTH.**
6. FiveM: if `passwordSet: false` → `fxmind_fivem_install` once, ask restart **fivem-start**. After resource edit → `fxmind_fivem_cmd` + `fxmind_fivem_console_tail`. Live debug: tagged prints → ensure → user reproduces → tail → fix → remove prints.
7. Ask when missing: target resource, expected behavior, job/permission, client vs server vs NUI, destructive/money/inventory rules. One pointed question with your recommended reading when only the user can settle.

Selective memory: never load all. Canonicalize slugs (accents, singular/plural).

## 6. Gate V + Judge

**Read `.fxmind/modes/task-verify.md` now.** Run Gate V (`fxmind_record_gate` `V`). Run Judge when that file says it is mandatory.

## 7. User corrections

After applying a user correction, AskQuestion: Pitfalls / `fxmind_record_correction` / both / new topic / don't save. Skip typos-only or when they already asked to save.

## 8. Gate C

Requires V (MCP enforces). Learn reusable knowledge → memory + validate; else "mudança pontual".

```
🛑 GATE C COMPLETE — LEARNING: <created/updated path | none — mudança pontual>
```
→ `fxmind_record_gate` `C`.

Memory rules: template + `lang: en-compact`; grep-confirmed frontmatter; `paths[]` or `triggers[]` non-empty; no memory for one-off/guess/dupe.

## Rules

- Never invent paths/events/APIs/permissions.
- Never ask user to ensure/restart or paste console — use MCP.
- Pack minimum evidence (when present): `.fxmind/minimum-evidence.md` before acting in that domain.
