# fxmind — Task verification

Gate V verifies code only: lint/syntax, applicable types and broken logic in the actual diff and directly affected callers. It does not certify runtime, visual appearance or gameplay. Questions, explanations and read-only investigations do not start a task or require Gate V.

## Before V

Inspect the changed code against the user's requested behavior. Check lexical scope, function order, control flow, boundaries, data contracts, error paths and concrete security/performance regressions. For a defect, inspect the affected area for the same failure pattern (TWINS); avoid unrelated cleanup or speculative refactors. Preserve refactor invariants.

Run existing lint/syntax checks and applicable typechecks. Use focused automated tests or a build when they help expose a defect. If no linter exists, use the available syntax/static check; do not install tooling or invent passing results. For non-executable changes, record a manual source/diff review. Tests should expose a real failure, not mirror the implementation; new tests are not mandatory for every tiny edit. Reuse results only while the checked code is unchanged.

## Scope

Gate V never requires opening a browser, screenshots, visual inspection, starting an application/game server, login credentials, manual gameplay or production access. This also applies to frontend/NUI code. Optional runtime/browser validation may be useful for the task or explicitly requested by the user, but is separate from Gate V. Report its status honestly; passing V must never be described as proof of runtime or visual behavior.

`evidence.ui` and `evidence.browser` remain accepted for compatibility but are not required or used to pass/block V. Legacy `runtime` checks are stored separately as informational observations; runtime evidence alone cannot pass code verification.

## Independent code review

Call `fxmind_record_gate { gate: "V", ... }` directly. It validates code-check evidence and Lua lexical scope, then automatically runs a fresh read-only code reviewer for non-trivial Lua/multi-file or fix/mechanic/create tasks. Known tiny tasks and single-file config tasks use the deterministic/evidence checks without an additional CLI review. Do not call a separate reviewer first.

The reviewer reads current source, diff and relevant callers directly. FxMind MCP/memory is optional for this reviewer; unavailable MCP must not block direct source inspection. Broad skill routers, UI checklists and runtime requirements do not expand its scope.

Only a concrete code defect with file:line and the broken execution path can block approval. Subjective style, hypothetical improvements, unrelated old issues and missing runtime proof are not blocking findings. Non-blocking suggestions may accompany `VERDICT: VERIFIED`.

- `VERDICT: VERIFIED`: code review passed.
- `VERDICT: REFUTED` or `VERDICT: VERIFIED WITH CAVEATS`: concrete code findings; fix surgically, rerun affected checks and retry V. Maximum three repair cycles for actual code findings.
- `VERDICT: UNVERIFIABLE`: source/tool/provider infrastructure prevented review. This is not a code finding. The server may try one provider fallback; report the limitation once, keep V unverified and do not repeat repair cycles or change code to fix infrastructure.

Lua also receives a deterministic lexical-scope check. A caller that resolves a later local function as a global, or calls a helper outside its lexical scope, fails before the reviewer runs.

## MCP evidence contract

```json
{
  "gate": "V",
  "sessionId": "<task session>",
  "evidence": {
    "files": ["src/server.js"],
    "review": "Checked changed conditions, callers and error paths; boundary validation is preserved.",
    "checks": [{
      "kind": "lint",
      "target": "node --check src/server.js",
      "expected": "Valid JavaScript syntax",
      "observed": "Exit 0, no syntax errors",
      "status": "passed"
    }]
  }
}
```

Use real paths, commands and observations. Code-check kinds: lint/typecheck/test/build/manual (source/diff review). Each check records target, expected, observed and status (passed/failed/blocked). List all task files, including deletions; Git discovery or scoped claims supplement the list.

Failed/blocked code checks keep V incomplete and prevent Gate C. A failed recheck invalidates prior approval. Review artifacts bind to current file contents and task goal/kind/playbook; editing code after V requires fresh checks and review before C. The server validates evidence structure and freshness, not the truth of agent-written observations.

## Additional validation

Use Judge when the user explicitly requests proof or sensitive authorization/money/data behavior needs deeper validation. Read `.fxmind/modes/judge.md`; keep any runtime/visual conclusions separate from the Gate V code verdict. Do not automatically turn routine code review into a runtime audit.

Keep verification notes concise. Report code-check failures and unverified runtime behavior accurately.
