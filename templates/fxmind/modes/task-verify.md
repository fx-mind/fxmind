# fxmind — Task verification

Success requires observed behavior matching the user's request. A green build or a completion report alone cannot establish it. Applies to all domains and quick/full modes.

## Before V

Review the task diff against Done and applicable pack rules. Confirm invariants for refactors, inspect error paths, remove unnecessary constants/helpers/files, debug remnants and unrelated churn. Do not replace required validation with cosmetic brevity.

For a defect, search the affected area for the same failure pattern (TWINS); fix in-scope equivalents or identify remaining sites. FiveM NUI CEF background bugs also inspect the whole resource's shell, popup/modal, styles and Vite output names using the relevant style reference.

Prioritize **lint/syntax, typecheck where applicable and code quality** on the actual changed code. Run the project's existing checks, then focused regression tests and build/runtime checks only where they establish Done. If no linter is configured, record the applicable syntax/static check; do not install tooling or invent a passing lint result. Tests must detect the original failure or assert observable behavior, not mirror the implementation. Reuse results only while the tested code is unchanged.

## UI: browser verification only for real interface changes

Assess the final diff and record `ui: { changed: boolean, reason: "specific diff-based explanation" }` in V evidence. Browser verification is required only when the change actually alters rendered content, layout/styles or user interactions, including backend changes that alter those outcomes. Merely touching a frontend path, reviewing an unchanged UI file, having `ui_page` in a manifest, an installed UI skill, or an old task planning flag does not require opening an interface.

When rendered output and user interactions are preserved, backend-only code, tooling/config/tests, comments/formatting and behavior-preserving refactors use `ui.changed: false` with a reason. Complete lint/static checks and code review without opening a browser. The independent reviewer must validate this assessment against the diff; a claim of no UI impact cannot exempt actual visual/interaction changes.

For visual or interaction changes, use the available browser tool or installed browser automation to:

1. Start/reuse the project's documented local preview and open the actual affected route.
2. Reproduce the user's flow: click/type/submit/navigate and check the resulting state. Exercise relevant empty/loading/error states and a narrower viewport when layout is affected.
3. Capture and inspect a screenshot of the resulting UI. Check clipping, overlap, spacing, contrast and expected content; inspect console/runtime errors and relevant failed requests.
4. Correct observed defects, repeat the affected interactions and inspect a fresh screenshot after the final edit.
5. Save the screenshot or trace produced by the browser tool, preferably in OS temp, and record its path with URL, interactions and observations.

Do not substitute curl, source review, DOM assertions alone or a build for visual inspection. Never fabricate screenshots, traces or tool observations. If the browser/runtime/login is unavailable, finish feasible checks, record blocked evidence with the concrete reason and explain what remains. Do not mark V complete or describe the UI as verified.

FiveM NUI: browser preview checks web behavior; CEF-specific claims require the NUI open in-game, actual visual evidence and console/DOM evidence when available. Clean up temporary wire/probe before final validation. If only browser preview was possible, record the missing in-game verification as a blocked runtime check.

## Gate V independent validation

`fxmind_record_gate { gate: "V", ... }` automatically launches a fresh read-only reviewer **for every task**. There is no separate review step the executor has to remember. The reviewer prefers a strong model from the same provider as the coding agent (for example the best available Codex reasoning model, Cursor model, or Claude Sonnet-class model), in a new session with no executor rationale. It receives the original goal, current files/diff, structured observations, binding policy, installed skill routers and relevant domain quality/style/security references.

Only strict `VERDICT: VERIFIED` lets V proceed. `VERIFIED WITH CAVEATS` / `REFUTED` return their findings to the coding agent with `fix_findings_and_retry_gate_v`; the executor fixes them without asking the user, reruns affected checks and calls V again. Any edit or task-context change makes a prior review stale. Reviewer unavailability is a blocker, never an implicit pass.

Lua files also receive a deterministic lexical-scope check before the LLM review. A caller that reaches a later `local function`, or an obvious wider-scope call to a narrower local helper, returns a repair finding immediately even if syntax/tests otherwise pass.

## MCP evidence contract

Call `fxmind_record_gate` with `gate: "V"`, sessionId and evidence:

```json
{
  "files": ["src/server.js"],
  "review": "Compared callers and invariants; removed the one-use forwarding helper.",
  "ui": { "changed": false, "reason": "Only server validation changed; rendered output and interactions are unchanged." },
  "checks": [{
    "kind": "lint",
    "target": "node --check src/server.js",
    "expected": "Valid JavaScript syntax",
    "observed": "Exit 0, no syntax errors",
    "status": "passed"
  }, {
    "kind": "test",
    "target": "node --test test/server.test.js",
    "expected": "Invalid input is rejected and valid input still succeeds",
    "observed": "Both assertions passed; exit 0",
    "status": "passed"
  }]
}
```

Use actual task paths/commands/results, not the example values. Check kinds: lint/typecheck/test/build/runtime/manual. Every check records target, expected, observed and status (passed/failed/blocked). Review is required outside FiveM too. Record the actual lint/syntax and quality findings first.

Only when `ui.changed: true`, add `browser`:
- passed: status, url, interactions[] (actions and observed outcomes), visual, console, artifact (existing non-empty screenshot/trace file).
- failed/blocked: status and reason. Include the observations in checks where relevant.

The task-start `ui: true` flag is a planning hint; final `evidence.ui` reflects actual changes and can correct that hint. Without an explicit assessment, changed UI source files, declared UI behavior or `browser.required` retain the conservative browser requirement. Unchanged UI files listed only as context do not trigger it in Git projects. All task files must be listed; Git-discovered changed files are included for unclaimed sessions, claimed paths for scoped parallel sessions.

The server checks gate order, evidence structure, artifact existence and code fingerprints. Failed/blocked observations persist with V incomplete. Code changes after V require fresh verification before C. These checks cannot authenticate agent-written observations; Judge must inspect the actual evidence.

## Judge

Use Judge before success for sensitive authorization/money/data behavior, unresolved intent conflicts, substantial cross-resource changes, or explicit proof requests. File count alone is not risk. Quick mode never exempts these cases.

Read `.fxmind/modes/judge.md`. Judge checks source, diff and real observations; missing critical behavior/browser evidence prevents VERIFIED. In an authorized implementation, fix actionable findings and repeat affected checks before V/C. A review-only request remains read-only.

Keep verification notes concise. Report failed or unverified work explicitly; do not end early just to produce a completion message.
