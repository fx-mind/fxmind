# fxmind — Mode: Learn

Generate or update a **topic memory** at `.fxmind/memory/<topic>.md` (shared by all agents).

**Do not implement code** in this mode — only scan, write markdown, and update index/reference links.

## Step 1 — Resolve topic

1. Parse `$ARGUMENTS` after `learn` (e.g. `craft`, `item-usavel`).
2. If `learn list` → read `.fxmind/memory/_index.md` and `.fxmind/topic-catalog.md`; reply with table; stop.
3. Normalize slug: lowercase, hyphens, no spaces → `memory/<slug>.md`.

## Step 2 — Load context

Read from `.fxmind/skills/`:

| File | Purpose |
|------|---------|
| `fivem-development/best-practices.md` | Patterns, anti-bugs |
| Framework skill (`vrp-framework`, etc.) | If detected |
| `.fxmind/topic-catalog.md` | Search hints for known topics |
| `.fxmind/memory.template.md` | Output skeleton |
| `.fxmind/reference.md` at project root | If exists — project paths |
| `.fxmind/memory/<topic>.md` | If exists — **merge** (preserve valid content, update paths) |

## Step 3 — Scan codebase

1. Match topic to catalog row if possible; use its grep/paths hints.
2. Unknown topic → infer paths from user request + `.fxmind/reference.md`.
3. Grep + read files — **every path in output must exist in the repo**.
4. Extract: config paths, handlers, events, checklists, one real example from the codebase.

## Step 4 — Write memory

Save to `.fxmind/memory/<topic>.md` using `memory.template.md` structure (**~25–60 lines**, token-efficient):

- Frontmatter: `topic`, `updated`, `framework`, `lang: en-compact`, `confidence: extracted`.
- Structured arrays (grep-confirmed): `resources`, `paths`, `events`, `exports`, `symbols`, `triggers`.
- Sections: `Files`, `Recipe`, `Example`, `Pitfalls`, `Skills` — **compact technical English only**.
- No prose, no tables unless essential; bullet lists and short imperative lines.
- Keep repo literals verbatim: paths, events, item ids, permissions, resource names.
- **Do not** write memory in Portuguese — memory is shared project context (`lang: en-compact`).

## Step 5 — Update index

Update `.fxmind/memory/_index.md` — table row: topic | file | triggers | last updated. Create from `memory-index.template.md` if missing.

## Step 6 — Update .fxmind/reference.md

If `.fxmind/reference.md` exists: ensure section `## Memórias por tópico` exists; add/update one table row per topic; keep the rest lean (do not duplicate full flows here). If absent, skip.

## Step 7 — Reply

Reply in **their language** (usually PT-BR): summary of what was learned (3–5 bullets), path `.fxmind/memory/<topic>.md`, suggest `/fxmind graph` to refresh the 3D knowledge map.

## Learn rules

- **Never invent** paths, events, or APIs.
- **Do not** edit Lua/JS during learn mode.
- Cursor Agent: use **AskQuestion** if critical context is missing; otherwise ask in chat.
- **Memory file:** compact technical English (`lang: en-compact`). **Chat reply:** user's language.
