# fxmind — Mode: Judge

**Invoke:** `/fxmind judge` · `/fxmind judge <target>` · "did that actually work?" · "verify what it did"

**Stance:** a completion report is a set of **claims**, not evidence. Believe nothing you did not observe.

**Judge is read-only.** In an already-authorized implementation, return findings to the executor to fix and re-verify. A review-only request does not authorize edits.

> Checklist: `.fxmind/policy/failure-modes.md`. Security/perf matrix → `/fxmind audit` (different mode).

## When this mode is mandatory

Called from Task after Gate V when **any** of (see `.fxmind/modes/task-verify.md`):

- substantial cross-resource behavior changes (file count alone is not risk)
- money / inventory / permission / job / vehicle / XP / ban / admin
- unresolved INTENT conflicts
- user asked to prove/verify

Otherwise optional.

## Target

Default: latest completed work in this conversation. Or named diff/branch/directory/pasted report.

## Procedure

1. **Collect claims** — done / verified / untouched (each row → prove, refute, or UNVERIFIABLE).
2. **Ground truth** — `git diff` + `git status` vs ask blast radius and Gate A SCOPE.
3. **Inspect actual evidence** — tests/runtime output tied to current code. Rerun checks when output is missing, stale or suspicious. UI: inspect browser interactions, screenshots and console observations; source/build alone cannot prove visual correctness. FiveM: status before commands; missing runtime means UNVERIFIABLE. Critical missing evidence prevents VERIFIED.
4. **Review failures**: weakened checks, false completion, scope creep, unauthorized outward actions, spec conflicts, missed twins, debris, unnecessary constants/helpers/files. Identify concrete defects and smallest fixes instead of rewarding checklist narration.
5. **Verdict first line:** `VERIFIED` | `VERIFIED WITH CAVEATS` | `REFUTED` — then claims table, frauds, smallest recommended fix (apply only if asked).

## Bounds

Minutes, not hours. Do not Write gates JSON. Persist under `.fxmind/audits/judge-<slug>.md` only if the user asks.

## suite (future)

`/fxmind judge suite` → see `eval/README.md` in the fxmind package. Until wired, run default judge.
