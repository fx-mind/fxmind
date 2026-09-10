# fxmind — Task verification

Success requires observed behavior matching the user's request. A green build or a completion report alone cannot establish it. Applies to all domains and quick/full modes.

## Before V

Review the task diff against Done and applicable pack rules. Confirm invariants for refactors, inspect error paths, remove unnecessary constants/helpers/files, debug remnants and unrelated churn. Do not replace required validation with cosmetic brevity.

For a defect, search the affected area for the same failure pattern (TWINS); fix in-scope equivalents or identify remaining sites. FiveM NUI CEF background bugs also inspect the whole resource's shell, popup/modal, styles and Vite output names using the relevant style reference.

Run the cheapest checks that establish Done plus surrounding health: focused tests, lint/typecheck/build as appropriate. Tests must detect the original failure or assert observable behavior, not mirror the implementation. Reuse results only while the tested code is unchanged.

## UI: browser verification is required

For visual or interaction changes, use the available browser tool or installed browser automation to:

1. Start/reuse the project's documented local preview and open the actual affected route.
2. Reproduce the user's flow: click/type/submit/navigate and check the resulting state. Exercise relevant empty/loading/error states and a narrower viewport when layout is affected.
3. Capture and inspect a screenshot of the resulting UI. Check clipping, overlap, spacing, contrast and expected content; inspect console/runtime errors and relevant failed requests.
4. Correct observed defects, repeat the affected interactions and inspect a fresh screenshot after the final edit.
5. Save the screenshot or trace produced by the browser tool, preferably in OS temp, and record its path with URL, interactions and observations.

Do not substitute curl, source review, DOM assertions alone or a build for visual inspection. Never fabricate screenshots, traces or tool observations. If the browser/runtime/login is unavailable, finish feasible checks, record blocked evidence with the concrete reason and explain what remains. Do not mark V complete or describe the UI as verified.

FiveM NUI: browser preview checks web behavior; CEF-specific claims require the NUI open in-game, actual visual evidence and console/DOM evidence when available. Clean up temporary wire/probe before final validation. If only browser preview was possible, record the missing in-game verification as a blocked runtime check.

## MCP evidence contract

Call `fxmind_record_gate` with `gate: "V"`, sessionId and evidence:

```json
{
  "files": ["src/server.js"],
  "review": "Compared callers and invariants; removed the one-use forwarding helper.",
  "checks": [{
    "kind": "test",
    "target": "node --test test/server.test.js",
    "expected": "Invalid input is rejected and valid input still succeeds",
    "observed": "Both assertions passed; exit 0",
    "status": "passed"
  }]
}
```

Use actual task paths/commands/results, not the example values. Check kinds: test/build/runtime/manual. Every check records target, expected, observed and status (passed/failed/blocked). Review is required outside FiveM too.

For UI add `browser`:
- passed: status, url, interactions[] (actions and observed outcomes), visual, console, artifact (existing non-empty screenshot/trace file).
- failed/blocked: status and reason. Include the observations in checks where relevant.

Declare `ui: true` at task start for UI behavior even when editing backend files. UI source extensions also trigger browser requirements automatically. All task files must be listed; Git-discovered changed files are included for unclaimed sessions, claimed paths for scoped parallel sessions.

The server checks gate order, evidence structure, artifact existence and code fingerprints. Failed/blocked observations persist with V incomplete. Code changes after V require fresh verification before C. These checks cannot authenticate agent-written observations; Judge must inspect the actual evidence.

## Judge

Use Judge before success for sensitive authorization/money/data behavior, unresolved intent conflicts, substantial cross-resource changes, or explicit proof requests. File count alone is not risk. Quick mode never exempts these cases.

Read `.fxmind/modes/judge.md`. Judge checks source, diff and real observations; missing critical behavior/browser evidence prevents VERIFIED. In an authorized implementation, fix actionable findings and repeat affected checks before V/C. A review-only request remains read-only.

Keep verification notes concise. Report failed or unverified work explicitly; do not end early just to produce a completion message.
