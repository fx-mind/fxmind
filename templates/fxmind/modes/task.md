# fxmind — Task

Use for requested code/config changes, including "analyze and fix". Questions and review-only requests stay read-only. Plan-first applies when the user requested a plan or a material decision is missing; existing authorization remains valid. User stop cancels further work immediately.

## Classify and define success

State the goal, scope, observable Done criteria and checks in a short note. For defects, identify the cause and one concrete reproduction before editing. For behavior changes, compare current behavior, expected behavior and the relevant spec; surface conflicts. Preserve explicit user decisions. For refactors, record INVARIANTS.

Quick mode reduces lookup and narration, not correctness. Use `trivial: true` only for a known one-file, roughly <10-line edit with no new behavior or discovery. UI, security, data mutations and unknown scope are not trivial. Otherwise use normal A/B, even in quick mode.

Read `.fxmind/modes/task-verify.md` before implementation when UI/runtime evidence is needed, so verification is feasible before coding.

## Start and context (A → B)

1. `fxmind_start_task` with a compact goal note and `ui: true` for visual/interaction changes (including backend changes that alter UI behavior). Keep the returned sessionId and pass it to gate/claim calls. Reuse FXMIND_SESSION_ID from panel context when supplied.
2. Gate A: record scope, Done, checks, INTENT/invariants when applicable in `fxmind_record_gate` note. Trivial tasks auto-complete A/B but still need verification.
3. Gate B: use relevant preloaded memories; otherwise query once (~1200–1500 tokens). Memories guide discovery; current source confirms them. Read implementation, callers and nearby conventions before editing.
4. If hits are missing/stale, use one bounded path/symbol search in the likely folder and read the results. Widen only when evidence requires it; no repeated repository dumps. If this provider denies native search, use an available permitted tool/subagent; don't evade its permissions.
5. Load only relevant pack references/corrections. For FiveM, read `.fxmind/skills/fivem-development/quality-gates.md` and the affected domain references; capture endpoint/payload/cache/validation/rate-limit/fan-out choices when those actually change. Verify unfamiliar APIs from primary sources.
6. Record B with paths, relevant rules and unresolved risks. After B, claim all task files before edits when sessions run in parallel.

Use MCP for gates, memory/graph and available domain operations. Missing MCP blocks gate-controlled implementation; report the missing capability. Read-only investigation can continue. Never write gate/session JSON directly.

## Implement and simplify

- Choose the smallest implementation that satisfies Done and matches nearby code. Reuse an existing pattern before adding a new layer.
- A new constant should name domain meaning, coordinate a repeated value or provide a real configuration point. Keep obvious one-use literals inline; do not hoist every string, CSS class, label or number into a constants block.
- Extract helpers for actual reuse or a meaningful lifecycle/domain boundary. Avoid single-use forwarding wrappers, speculative factories, generic configuration systems and extra files with no concrete responsibility. Preserve useful existing abstractions.
- Validate at actual trust boundaries. Do not scatter redundant guards, coercions, catches or fallbacks that hide defects; preserve required security checks.
- Comments explain non-obvious reasons. Remove narration, debug output, dead code and unrelated formatting churn.
- Before every fix, state the failing observation and a testable hypothesis internally. Change one cause, then rerun the relevant check. After repeated failure with no new evidence, change the diagnostic approach. Three attempts with the same hypothesis → report the unresolved blocker, never pretend success.
- Reuse successful checks while the relevant code is unchanged. Batch independent reads/checks; delegate only separable work with a clear result and useful time savings. Avoid delegation for tiny tasks.
- No unrelated changes or new dependencies for convenience. Respect existing authorization for commits/push/deploy; ask only for actions outside it.

FiveM local verification: call `fxmind_fivem_status` before commands. If available, run ensure/restart and console tail yourself. For NUI inspect DOM/state with wire → dump → unwire and visually inspect the actual runtime; desktop browser alone does not prove CEF rendering. Missing runtime is a verification blocker, not a passing check. Install missing dev integration once when within scope and report any required server restart. Never target production implicitly.

Scratch belongs in OS temp or a session-owned path. Clean up only files this task created; never delete a shared tmp directory used by other sessions.

## Review, verify and finish (V → C)

Review the entire task diff for requirement coverage, invariants, boundary failures and unnecessary complexity. For each new constant/helper/file ask what concrete readability/reuse/domain benefit it provides; simplify unjustified additions. FiveM also runs its quality-gates checklist.

Run `.fxmind/modes/task-verify.md`. Record V with structured evidence. Failed or blocked verification keeps V incomplete; don't call C or claim completion. Fix observed defects within the authorized task, then repeat affected checks. Run Judge when the verification mode requires it; fix actionable findings and re-verify.

Gate C requires passing, current V evidence. Save reusable, verified knowledge only; otherwise note "mudança pontual". Validate changed memories. Record reusable user corrections when already authorized; otherwise offer to save them once. Remove temporary instrumentation before final verification.

Use gate notes as the audit record; don't duplicate long markers/checklists in chat. Final reply: actual outcome, checks performed and any remaining limitations.
