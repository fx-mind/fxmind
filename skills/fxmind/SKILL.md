---
name: fxmind
description: "Use for code/config changes in projects with .fxmind/ and for /fxmind commands: shared memory, domain skills, task gates, verification and learning."
---

# fxmind

Shared knowledge lives under `.fxmind/`; domain skills live in `.fxmind/skills/`, not the agent's skills directory.

## Routing

- Code/config implementation, including "analyze and fix": read `.fxmind/modes/task.md`.
- New resource/system: read `.fxmind/modes/create.md` (design + approval before code).
- Large rewrite/optimization of an existing resource: read `.fxmind/modes/refactor.md`.
- Review/question only: investigate and answer; do not turn it into implementation.
- Explicit `/fxmind judge`: read `.fxmind/modes/judge.md`.
- Explicit `/fxmind teach <name>`: read `.fxmind/modes/teach.md` (turn a task that worked into a playbook).
- Other `/fxmind` commands: read `.fxmind/fxmind.md`, then only the matching mode.
- Verification: read `.fxmind/modes/task-verify.md`; for UI, read it before editing to prepare browser checks.

Quick/full adjusts effort and narration, not quality requirements. Quick does not imply trivial. Only known tiny changes without new behavior qualify for auto A/B.

## Lean engineering (all coding agents and delegated reviewers)

Use the existing Gate B to choose the **smallest complete solution**: first ask whether new code is needed, search for existing helpers/events/components and playbooks, then prefer platform/standard APIs or installed dependencies. Only introduce new code, abstraction, configuration or dependency when those options cannot satisfy the task. Check the affected callers and source; FXMIND's optional compact symbol map is just a hint, not an authoritative AST. For Lua/FiveM search event registrations, exports and resource boundaries; keep existing security/permission checks. Do not cut requirements, failure handling, privacy, tests or UI verification to reduce lines. In Gate V, independently review unnecessary duplication, scope creep and missed tests as well as functional correctness. The same criteria apply to subagents; no new Gate or mandatory MCP call is required.

## Context and control

When choosing between FxMind discovery tools is ambiguous, call `fxmind_route_tool` once (advisory only). It proposes a read-only MCP tool; it does not call it, authorize actions or replace gates. If the preloaded context already recommends a tool, use that hint instead of calling the router again. Follow known playbooks and preloaded memories first.

A `# fxmind — playbook` block in the preloaded context is the procedure for a repeated request: follow its files/anchors, skip discovery, pass `kind` + `playbook` to `fxmind_start_task`. Task kind (config / fix / mechanic / create) is stated at Gate A; see `task.md`. For repository-specific questions or tasks needing code context, use preloaded precise facts first, otherwise call `fxmind_query` once before generic Grep. For ordinary non-repository questions, answer directly without memory lookup or gates. Read source to confirm memory claims. If retrieval lacks coverage, call bounded `fxmind_search` first; only then use native Grep/ripgrep as fallback or verification. If MCP is disconnected, say so and fall back to native search; never invent paths or repeat blind queries. Load only relevant references/corrections.

Gates are MCP-managed: start → A → B → implement/checks → **V auto-review** → C. Every `fxmind_record_gate(V)` automatically dispatches a fresh read-only reviewer, preferring a strong model from the same provider and loading relevant installed skill rubrics. Strict VERIFIED is required. If V returns findings, fix them without asking the user, rerun affected checks and retry V; edits make the previous review stale. Keep sessionId; parallel agents claim task paths before editing. Never write gate/session JSON directly. Missing MCP prevents gate-controlled edits but need not prevent read-only investigation.

Read gate requirements from the mode files instead of duplicating them in chat. User-facing replies stay short and direct: outcome first, no long explanations. Failed/blocked V stays open. Browser interaction, screenshot inspection and console observations are required for UI; build alone is insufficient. State missing verification honestly.

## Domain routing

Read only installed entries from `.fxmind/skills/_index.md`:
- FiveM: `.fxmind/policy/fivem-principles.md` is binding for every change (scope/payload/chunks/statebags/anti-flood, no DB in hot paths, minimal code); then `fivem-development/quality-gates.md` rows for the touched artifacts and relevant references.
- Framework calls: the matching vRP, QBCore, Qbox or ESX skill.
- NUI/React: `fivem-react-nui/SKILL.md`.

FiveM dev tools: status before ensure/restart/tail; use tools yourself when available. Missing runtime blocks runtime verification. NUI wire/dump must be unwired before final validation; CEF visuals require in-game evidence. Respect real DB mutation boundaries and never invent approval.

Atomic source-linked memories live in the project-keyed global graph store by default; legacy Markdown under `.fxmind/memory/` is preserved and indexed as granular facts. For `/fxmind learn`, use `fxmind_graph.addFact` with exact source evidence, not broad topic Markdown. Audits and corrections remain under `.fxmind/audits/` and `.fxmind/corrections/`. Save verified reusable knowledge, preserve existing decisions. Stop immediately when the user asks.
