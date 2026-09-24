# fxmind — Mode: Create (new resource)

Use when the user asks for a new resource/system ("crie uma resource de ...", `/fxmind create <description>`). Design first, build after approval. The design is the contract the build is verified against.

## 1. Discover (read-only)

- Detect the framework and available dependencies (oxmysql, target, ox_lib, cerberus, NUI stack) from neighbouring `fxmanifest.lua` files and `.fxmind/reference.md`.
- Use preloaded memories or `fxmind_query` once for the domain; find the closest existing resource and copy its conventions, not its defects.
- FiveM: read `.fxmind/policy/fivem-principles.md` (binding) and only the skill references the design touches (security for money/items, NUI guide for UI, framework skill for API calls). Verify natives/APIs from primary docs.

## 2. Design

Write `.fxmind/designs/<resource>.md` from `.fxmind/templates/resource-design.md` (`kind: create`, `status: draft`). Fill every table; one line per decision:

- **State ownership** — for each piece of data: owner, storage, how others see it (statebag vs on-demand pull vs none).
- **Network contract** — every event/callback with recipients (N1), payload shape and estimated size (N2/N3), frequency (N4) and rate limit/validation (N6).
- **Database** — when each table is read/written; hot paths use cache/write-behind (D1).
- **Threads** — each loop justified, with its sleep; replace with handlers when possible (T1).
- **Files** — the minimum set (C1/C2).
- **Principles check** — every ID answered.
- **Build slices** — small runnable steps, each with its verification.

Surface real choices as open questions instead of guessing (e.g. persistence, who may use it, UI or command). Keep the design compact: tables, no prose.

## 3. Approval checkpoint

Reply short: link to the design, the 3–5 key decisions, open questions. Wait for approval unless the user already said to build without review. Apply requested changes to the design, set `status: approved`.

## 4. Build

Run Task mode (`.fxmind/modes/task.md`) per slice with the design as Done: Gate A cites the design path; Gate B lists the slice files. Implement exactly the approved contract; any deviation updates the design first and is reported.

## 5. Verify and close

Gate V `review` compares the diff with the design: every event/callback/loop/query exists as designed (recipients, payload, rate limit), nothing extra was added, principle IDs checked. Runtime: ensure + console tail, then the Done flows in-game when available. Set `status: built`; `/fxmind learn <resource>` saves the verified memory.
