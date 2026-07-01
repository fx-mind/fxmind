# fxmind — Mode: Reference

Generate or update **`.fxmind/reference.md`** — the project map with paths, flows, and anti-bug notes for all agents (Cursor, opencode, Claude, Gemini).

Keep it **lean**: detailed flows for recurring topics belong in `.fxmind/memory/<topic>.md` via `/fxmind learn <topic>` — do not paste full craft/item recipes here. Memory files use compact technical English (`lang: en-compact`); only link to them from this reference.

### Step 1 — Discover the project

Search and read (do not guess paths):

1. **Framework** — `fxmanifest.lua` dependencies, `resources/[System]/`, `qb-core`, `qbx_core`, `es_extended`, `vrp`.
2. **Core config** — item lists, groups/jobs, economy, shops.
3. **Custom resources** — `[Novos]`, `[Exclusive]`, `[Scripts]`, etc.
4. **Integrations** — `cacheaside`, `cerberus`, `oxmysql`, `ox_lib`, webhooks/Discord.
5. **NUI** — React/Vite projects (`src/ui/project`, build output paths).
6. **Security patterns** — server validation, cooldowns, inventory validation.
7. **Git** — submodules, monorepo layout.

Use semantic search, grep, and file reads. Every path in the output must exist in the repo.

### Step 2 — Read existing context

- If `.fxmind/reference.md` exists → read it and **merge/update** (preserve valid sections, replace outdated paths).
- Read `.fxmind/reference.template.mdc` for section structure (installed by fxmind).
- Read `.fxmind/reference.example.mdc` for format/depth only (fictional sample — do not copy its paths).

### Step 3 — Write `.fxmind/reference.md`

Use this frontmatter:

```yaml
---
description: <ProjectName> — referência rápida FiveM (<framework>)
---
```

Required sections (adapt titles to what exists in **this** project):

1. **Manutenção desta referência** — update when new patterns appear.
2. **Framework / grupos / permissões** — how auth works in this codebase.
3. **Itens / inventário** — registration files, use handlers, naming conventions.
4. **Economia / lojas / webhooks** — shop configs, webhook paths.
5. **Sistemas custom** — one line per major feature pointing to memory or key config path (e.g. "Craft → `/fxmind learn craft` ou `memory/craft.md`").
6. **Memórias por tópico** — table linking topics to `.fxmind/memory/*.md` (filled by `/fxmind learn`).
7. **Integrações** — cacheaside, cerberus (`SendFullSync` / `SendDeltaSync`, `SafeEvent`, `SetCooldown`), oxmysql patterns **as used here**.
8. **NUI** — source folder + `pnpm run build` path if applicable.
9. **Git / submodules** — if relevant.
10. **Skills FiveM** — `.fxmind/skills/` (pack skills); agent folder has only `fxmind` skill.

Write in **Portuguese** if the codebase/comments are PT-BR; otherwise match project language.

### Step 4 — Confirm

After writing the file, reply with: framework detected, sections documented, paths that need manual review (if any), file created `.fxmind/reference.md`.

### Rules

- **Never invent** file paths, events, or APIs — verify with search.
- **Do not** paste generic FiveM tutorials — only project-specific findings.
- Prefer **actionable** notes: where to edit, checklists, common bugs.
