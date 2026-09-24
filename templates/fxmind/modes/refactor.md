# fxmind — Mode: Refactor (rewrite a badly written resource)

Use for large rewrites/optimizations of an existing resource (`/fxmind refactor <resource>`, "refaça/otimize a resource X"). Small, local fixes stay in Task mode. Audit only diagnoses; this mode turns findings into a behavior-preserving rewrite.

## 1. Scope and findings

- Scope is the full `fxmanifest.lua` file list.
- If `.fxmind/audits/<resource>.md` exists and is current, use its findings as input — do not re-audit. Otherwise record findings while inventorying (step 2); run a full audit only when the user asked for a report.
- FiveM: read `.fxmind/policy/fivem-principles.md` (binding) and the skill references for the areas being rewritten.

## 2. Current contract (the invariants)

Write `.fxmind/designs/<resource>.md` from `.fxmind/templates/resource-design.md` (`kind: refactor`). Fill **Current contract** from the code: every net event, callback/tunnel function, export, command, DB table/query, statebag key, NUI message/callback and config key — with `file:line`. Other resources depend on these names; they stay identical unless a change is approved.

## 3. Target design

Fill the design tables for the new version: state ownership, network contract (recipients, payload, frequency, rate limit), DB access (cache/write-behind), threads, files, principles check. Mark every intentional behavior change in the contract table as `changed: <why>`. Removing duplicated/unused code is expected (C1) but must not remove a contract entry silently.

## 4. Plan slices and approve

Split into slices that each leave the resource runnable, ordered by risk/benefit, typically: data layer (cache, no DB in hot paths) → network (scope, payload, chunks, statebags) → threads (sleep, handlers) → code cleanup. Reply short with the design path, the slices, behavior changes and open questions. Wait for approval unless already authorized.

## 5. Execute

One Task (`.fxmind/modes/task.md`) per slice; Gate A cites the design and slice; record INVARIANTS as the contract rows the slice touches. Rewrite freely inside the slice — prefer deleting and rewriting a function over patching layers onto bad code — while keeping every contract name and payload shape the callers use.

## 6. Parity verification

Gate V per slice: every contract row touched is present (or approved-changed) — check names with `fxmind_search`; external callers of changed exports/events are found and updated or listed. Runtime: ensure + console tail; exercise the main flows in-game when available. After the last slice, set `status: built`, update the audit report status if one exists, and `/fxmind learn <resource>` saves the new structure.
