# fxmind — Task

Use for requested code/config changes, including "analyze and fix". Questions and review-only requests stay read-only. Plan-first applies when the user requested a plan or a material decision is missing; existing authorization remains valid. User stop cancels further work immediately.

## Classify and define success

State the goal, scope, observable Done criteria and checks in a short note. For defects, identify the cause and one concrete reproduction before editing. For behavior changes, compare current behavior, expected behavior and the relevant spec; surface conflicts. Preserve explicit user decisions. For refactors, record INVARIANTS.

Quick mode reduces lookup and narration, not correctness. Use `trivial: true` only for a known one-file, roughly <10-line edit with no new behavior or discovery. UI, security, data mutations and unknown scope are not trivial. Otherwise use normal A/B, even in quick mode.

Read `.fxmind/modes/task-verify.md` before implementation when UI/runtime evidence is needed, so verification is feasible before coding.

## Kind and playbook

Every task has a **kind**; it decides how context loads. State `KIND: <kind>` in Gate A (the preload gives a first guess — correct it when wrong) and pass `kind` to `fxmind_start_task`.

| kind | What it is | Context to load | Extra rules |
|------|-----------|-----------------|-------------|
| `config` | Register/change a data entry: item, skin, price, permission, list row | **Playbook** if one matched; else memory `Files` + `Recipe` only | No design, no broad search. If no playbook existed and it worked, offer `/fxmind teach <name>` at Gate C |
| `fix` | Defect: error, "não funciona", wrong result | Memory `Files` + `Pitfalls` + `symbols[]` matching the error, recent `corrections`, console tail | Reproduce first, name the cause, run TWINS |
| `mechanic` | Change how existing behavior works | Whole memory flow + graph neighbours (callers, events, exports) + relevant principle IDs | INTENT (code / check / spec) before editing |
| `create` | New resource | `.fxmind/modes/create.md` | Design + approval first |

**Playbook** (`.fxmind/playbooks/<id>.md`): the preload injects a `# fxmind — playbook` block when the request matches one — files, current line numbers of the anchors, snippets, verify checks and the related memory Pitfalls. It replaces discovery:

1. Confirm the request fits the playbook and collect its inputs; ask only for what is missing.
2. `fxmind_start_task { kind, playbook }`. A **verified** playbook auto-completes Gates A and B; a `draft` one still records A/B normally. V and C are always required.
3. Read ~25 lines around each listed anchor, edit, then run the playbook's `Verify` checks at Gate V. Skip `fxmind_query` and repository search.
4. File or anchor not found, or the code contradicts a step → stop, say so, continue with the memory flow, and at Gate C fix the playbook (`.fxmind/modes/teach.md`). Never edit at a guessed location.

`fxmind_playbook` (MCP) lists, matches, shows and checks playbooks when the preload did not include one but the request looks like a repeated task.

## Start and context (A → B)

1. `fxmind_start_task` with a compact goal note and `ui: true` for visual/interaction changes (including backend changes that alter UI behavior). Keep the returned sessionId and pass it to gate/claim calls. Reuse FXMIND_SESSION_ID from panel context when supplied.
2. Gate A: record scope, Done, checks, INTENT/invariants when applicable in `fxmind_record_gate` note. From Gate A on, user-facing replies stay short and direct — lead with the outcome, no long explanations or gate ceremony. Trivial tasks auto-complete A/B but still need verification.
3. Gate B: use relevant preloaded memories; otherwise query once (~1200–1500 tokens). Memories guide discovery; current source confirms them. Read implementation, callers and nearby conventions before editing.
4. If hits are missing/stale, use one bounded path/symbol search in the likely folder and read the results. Widen only when evidence requires it; no repeated repository dumps. If this provider denies native search, use an available permitted tool/subagent; don't evade its permissions.
5. Load only relevant pack references/corrections. For FiveM, read `.fxmind/policy/fivem-principles.md` (binding), then the `quality-gates.md` rows for the artifacts you touch and the affected domain references; for each new/changed event, callback, loop, query or statebag note recipients, payload size, frequency, DB access and whether the client can read it itself. Verify unfamiliar APIs from primary sources.
   A new resource belongs in `.fxmind/modes/create.md`; a rewrite of most of a resource in `.fxmind/modes/refactor.md`.
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

Review the entire task diff for requirement coverage, invariants, boundary failures and unnecessary complexity. For each new constant/helper/file ask what concrete readability/reuse/domain benefit it provides; simplify unjustified additions. FiveM also checks every principle ID in `.fxmind/policy/fivem-principles.md` against the diff and cites them in the V `review`.

After local checks pass, run `fxmind_independent_review` whenever the task is Lua, multi-file, or kind `fix`/`mechanic`/`create`. Treat `VERIFIED WITH CAVEATS` and `REFUTED` as failures: fix findings, rerun affected checks, then request a fresh review. The reviewer is read-only, must not receive the executor rationale, and its file fingerprint becomes stale after any edit.

Run `.fxmind/modes/task-verify.md`. Record V with structured evidence. Failed or blocked verification keeps V incomplete; don't call C or claim completion. Fix observed defects within the authorized task, then repeat affected checks. Run Judge when the verification mode requires it; fix actionable findings and re-verify.

Gate C requires passing, current V evidence. Save reusable, verified knowledge only; otherwise note "mudança pontual". For a `config` task done without a playbook, or one that deviated from its playbook, offer `/fxmind teach <name>` once (the diff you just verified is the source). Validate changed memories. Record reusable user corrections when already authorized; otherwise offer to save them once. Remove temporary instrumentation before final verification.

Use gate notes as the audit record; don't duplicate long markers/checklists in chat. Final reply: short and direct — actual outcome, then only blockers or the next user action.
