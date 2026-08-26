# fxmind — Task verify (Gate V + Judge triggers)

**Load on demand** from Task mode after Implement + **diff self-review** (see `task.md` §5b). Do not narrate step headers to the user.

## Pre-Gate V — self-review (FiveM tasks)

Before observation checks, confirm you ran `.fxmind/skills/fivem-development/quality-gates.md` self-review loop on the diff. **Gate V cannot close without these lines** (include inside the marker):

```
REVIEW: endpoints <n> (<names>) — quality checks <pass|fixed: list|deferred: list> — clean-code <pass|fixed: list>
PARITY: <n/a | invariants preserved | changed: reason>   ← required when Gate A had INVARIANTS (refactor)
```

Non-FiveM tasks: `REVIEW: n/a — non-FiveM` and `PARITY: n/a`.

## Gate V — verify by observation

Claims are not evidence. Observe:

1. **(a)** Gate A **Done** criterion passes (ran, rendered, counted, console clean) — not inferred from reading code alone.
2. **(b)** Surrounding health for the touched area (lint/tests/build if present; FiveM: `fxmind_fivem_status` first — when `available: true`, `fxmind_fivem_cmd` ensure/restart + `fxmind_fivem_console_tail` when a resource changed; otherwise UNVERIFIABLE and ask user to run ensure manually). Targeted green + broken surroundings = failed verification.
3. **(c) Twin check** when you fixed a defect — search the project and include verbatim:
   `TWINS: searched <pattern> — found other sites: <files, or "none">`
   Fix them or list them.

If something cannot be verified: label **UNVERIFIABLE** — never pass as verified.

On failure: mechanical mistake → Implement; surprise → re-open evidence (Gate B). Hard bound: **3** fix→verify cycles, then hand-back with output + hypothesis.

Output:
```
🛑 GATE V COMPLETE — REVIEW: <line>, PARITY: <line>, DONE: <observed|failed|unverifiable>, CHECKS: <what ran>, TWINS: <n/a | summary>
```
Then **`fxmind_record_gate`** `gate: "V"` (include REVIEW + PARITY in `note` if supported). **Gate C is rejected by MCP until V is recorded.**

**Forbidden:** Gate V without REVIEW line on FiveM tasks = verification theater (failure mode #14).

## When Judge is mandatory

After Gate V, run **`/fxmind judge`** (read `.fxmind/modes/judge.md`) before the final success claim if **any** of:

- **≥3 files** changed (or scope spans >1 resource)
- Touches **money / inventory / permission / job / vehicle / XP / ban / admin**
- Behavior change with an **INTENT** line (non-trivial)
- User asked to prove / verify / "did that work?"

Otherwise Gate V alone is enough. Judge is read-only unless the user asks to apply fixes.

## Reply artifacts (owed only)

- `INTENT: ...` — behavior changed
- `REVIEW: ...` — FiveM quality self-review (from quality-gates.md)
- `PARITY: ...` — refactor invariant check
- `TWINS: ...` — defect fixed
- `AUTH: user said "..."` — outward action (push/deploy-remote/publish/send). Local ensure/restart does **not** need AUTH
- `PENDING: <action> — awaiting your authorization` — prescribed follow-up deliberately skipped

**Outcome first:** what happened → evidence → honest caveats. Hostile reread before send.

Failure map: `.fxmind/policy/failure-modes.md`.
