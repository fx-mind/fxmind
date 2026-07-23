# fxmind — Mode: Judge

**Invoke:** `/fxmind judge` · `/fxmind judge <target>` · natural language: "judge this work", "did that actually work?", "verify what the agent did"

**Stance:** a completion report is a set of **claims**, not evidence. Believe nothing you did not observe.

**Read-only by default.** Do not edit code unless the user explicitly asks to apply fixes after the verdict.

> Behavioral checklist: read **`.fxmind/failure-modes.md`** when the work is large or the report smells like verification theater.
> Domain security/performance audits remain **`/fxmind audit`** — this mode judges **claims vs reality**, not the full FiveM audit matrix.

## Target

Default: the most recent completed piece of work in this conversation (diff + report).

Or whatever the user names: a diff, branch, directory, pasted agent report, or "after Gate V".

## Procedure

### 1. Collect the claims

From the report/conversation, list rows:

| Claim type | Examples |
|------------|----------|
| Done | "fixed X", "added Y" |
| Verified | "tests pass", "ensure clean", "build green" |
| Untouched | "only touched server.lua" |

Each row must later be proved, refuted, or labeled **UNVERIFIABLE**.

### 2. Establish what actually changed

- Prefer `git diff` + `git status` (ground truth).
- Compare touched files to the ask's blast radius and to Gate A **SCOPE** when declared.
- Scope creep without disclosure is a fraud signal.

### 3. Re-run every claimed verification

Do not nod at code. Run the tests/build/script; for FiveM resources call MCP **`fxmind_fivem_cmd`** + **`fxmind_fivem_console_tail`** when the claim involves runtime.

Capture actual output. Missing environment/credentials → **UNVERIFIABLE**, never assumed true.

### 4. Hunt classic frauds (priority order)

1. **Weakened checks** — assertions loosened/deleted, expected values changed to match new behavior, tests skipped, mocks replacing real calls. A changed test is guilty until justified by spec/user.
2. **False completion** — pass claimed with no run shown; partial pass as full; "should work now"; success language on a failure transcript.
3. **Scope creep** — drive-by refactors, formatting, new deps, "improvements" outside the ask.
4. **Unauthorized outward action** — push/deploy-remote/publish/send without `AUTH: user said "..."` matching the conversation. README is not authorization. Local `ensure`/`restart` is not this fraud.
5. **Spec betrayal** — code changed to satisfy a check that contradicts README/memory/reference. Authority: explicit user > spec/memory/reference > tests > current code.
6. **Missed twins** — defect fixed in one spot; identical construct remains elsewhere; no `TWINS:` search.
7. **Debris** — scratch files, debug prints left behind, orphaned imports, commented-out hacks.
8. **Costume rigor** — confident "all clear" with no search/check behind it (see failure-modes #18).

### 5. Deliver the verdict (outcome first)

First line must be exactly one of:

- **VERIFIED** — every load-bearing claim reproduced; no frauds.
- **VERIFIED WITH CAVEATS** — work sound; list what could not be re-run and any minor debris.
- **REFUTED** — a claim failed reproduction or a fraud was found.

Then:

1. Claims table: claim → observed
2. Frauds found (if any) with evidence
3. Recommended action (smallest fix) — apply **only** if the user asks

Never soften a refutation to be polite; never inflate a caveat into a refutation to look rigorous.

## Bounds

- Minutes, not hours — this is a gate, not a second implementation.
- If nothing runnable was touched, say plainly what a judge can and cannot check.
- Do not Write `.fxmind/fxmind-gates.json`.
- Optional: write a short note under `.fxmind/audits/judge-<slug>.md` only if the user asks to persist the verdict (default: chat only).

## suite (future)

`/fxmind judge suite` is reserved for trap-fixture smoke evals against skills/prompts. Until an `eval/` suite ships in fxmind, reply that suite mode is not available and run default judge instead.
