---
name: fxmind
description: "Use for code/config changes in projects with .fxmind/ and for /fxmind commands: shared memory, domain skills, task gates, verification and learning."
---

# fxmind

Shared knowledge lives under `.fxmind/`; domain skills live in `.fxmind/skills/`, not the agent's skills directory.

## Routing

- Code/config implementation, including "analyze and fix": read `.fxmind/modes/task.md`.
- Review/question only: investigate and answer; do not turn it into implementation.
- Explicit `/fxmind judge`: read `.fxmind/modes/judge.md`.
- Other `/fxmind` commands: read `.fxmind/fxmind.md`, then only the matching mode.
- Verification: read `.fxmind/modes/task-verify.md`; for UI, read it before editing to prepare browser checks.

Quick/full adjusts effort and narration, not quality requirements. Quick does not imply trivial. Only known tiny changes without new behavior qualify for auto A/B.

## Context and control

Use relevant preloaded memories, otherwise `fxmind_query`. Read source to confirm memory claims. If retrieval lacks coverage, use bounded permitted source search; never invent paths or repeat blind queries. Load only relevant references/corrections.

Gates are MCP-managed: start → A → B → implement/review → V with evidence → C. Keep sessionId; parallel agents claim task paths before editing. Never write gate/session JSON directly. Missing MCP prevents gate-controlled edits but need not prevent read-only investigation.

Read gate requirements from the mode files instead of duplicating them in chat. User-facing replies stay short and direct: outcome first, no long explanations. Failed/blocked V stays open. Browser interaction, screenshot inspection and console observations are required for UI; build alone is insufficient. State missing verification honestly.

## Domain routing

Read only installed entries from `.fxmind/skills/_index.md`:
- FiveM implementation/refactor: `fivem-development/quality-gates.md` and relevant style/security/performance/communication/API references.
- Framework calls: the matching vRP, QBCore, Qbox or ESX skill.
- NUI/React: `fivem-react-nui/SKILL.md`.

FiveM dev tools: status before ensure/restart/tail; use tools yourself when available. Missing runtime blocks runtime verification. NUI wire/dump must be unwired before final validation; CEF visuals require in-game evidence. Respect real DB mutation boundaries and never invent approval.

Memories are Markdown under `.fxmind/memory/`, audits under `.fxmind/audits/`, corrections under `.fxmind/corrections/`. Graph/state are derived local data. Save verified reusable knowledge, validate changed memories, preserve existing user decisions. Stop immediately when the user asks.
