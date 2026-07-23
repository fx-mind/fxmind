# fxmind — Mode: Judge

**Invoke:** `/fxmind judge` · `/fxmind judge <target>` · "did that actually work?" · "verify what it did"

**Stance:** a completion report is a set of **claims**, not evidence. Believe nothing you did not observe.

**Read-only by default.** Fixes only if the user asks after the verdict.

> Checklist: `.fxmind/failure-modes.md`. Security/perf matrix → `/fxmind audit` (different mode).

## When this mode is mandatory

Called from Task after Gate V when **any** of (see `.fxmind/modes/task-verify.md`):

- ≥3 files changed or >1 resource
- money / inventory / permission / job / vehicle / XP / ban / admin
- non-trivial INTENT behavior change
- user asked to prove/verify

Otherwise optional.

## Target

Default: latest completed work in this conversation. Or named diff/branch/directory/pasted report.

## Procedure

1. **Collect claims** — done / verified / untouched (each row → prove, refute, or UNVERIFIABLE).
2. **Ground truth** — `git diff` + `git status` vs ask blast radius and Gate A SCOPE.
3. **Re-run claimed checks** — tests/build; FiveM: `fxmind_fivem_cmd` + `fxmind_fivem_console_tail`. Missing env → UNVERIFIABLE.
4. **Hunt frauds** (order): weakened checks → false completion → scope creep → unauthorized outward action (not local ensure) → spec betrayal (user > memory/reference > tests > code) → missed twins → debris → costume rigor.
5. **Verdict first line:** `VERIFIED` | `VERIFIED WITH CAVEATS` | `REFUTED` — then claims table, frauds, smallest recommended fix (apply only if asked).

## Bounds

Minutes, not hours. Do not Write gates JSON. Persist under `.fxmind/audits/judge-<slug>.md` only if the user asks.

## suite (future)

`/fxmind judge suite` → see `eval/README.md` in the fxmind package. Until wired, run default judge.
