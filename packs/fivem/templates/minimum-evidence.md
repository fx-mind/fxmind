# Minimum evidence set — FiveM pack

Binding for agents when the task is FiveM resource work. **Open these before editing behavior** (Gate B / Implement). Changes nouns only; Task loop stays the same.

## Must open (every non-trivial FiveM task)

1. Target resource **`fxmanifest.lua`** (full file list + deps).
2. **`.fxmind/reference.md`** if present (project map / anti-bug notes).
3. Matching **`.fxmind/memory/<topic>.md`** via `fxmind_query` or index (3–5 max) — or state none matched.
4. Framework skill for the detected stack (`vrp` / `qb-core` / `qbx_core` / `es_extended`) when calling framework APIs.

## Must open when the topic matches

| Topic | Open |
|-------|------|
| Broadcast / TriggerClientEvent(-1) / manager:* | `fivem-development/performance.md` (§ broadcast) + memory if any |
| View cache / NUI / React | `fivem-react-nui/SKILL.md` + performance view-cache rows |
| Security / money / inventory / admin | `fivem-development/security.md` |
| Audit request | `.fxmind/audit-procedure.md` (not this file) |

## Authority order (FiveM)

Explicit user statement > `.fxmind/memory/*` + `reference.md` > pack skill docs > framework upstream docs > current code behavior.

## Verify by observation

- Resource touched → `fxmind_fivem_cmd` (`ensure`/`restart`) + `fxmind_fivem_console_tail` (no script errors).
- NUI change → confirm UI path/build artifact exists or page renders when runnable.
- Cannot verify → UNVERIFIABLE, never "should work".

## Fraud table (Judge hunts these)

- Fake "ensure clean" without console_tail output
- `TriggerClientEvent("manager:*", -1, ...)` or equivalent broadcast of privileged events
- Weakened permission/job checks to "make it work"
- Client-trusted money/inventory mutations
- Debug `print`s left behind
- Scope creep across unrelated resources

## Sources

- Pack skills under `.fxmind/skills/`
- Project memories under `.fxmind/memory/`
- FiveM natives: https://docs.fivem.net/natives/
