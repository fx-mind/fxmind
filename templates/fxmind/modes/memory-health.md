# fxmind — Mode: Memory health

Verify **topic memories** against the live codebase and **integration** (`_index.md`, `.fxmind/reference.md`). Optionally **auto-fix** stale content and **compact token format**.

**Read-only by default.** With `fix` → rewrite markdown only (memories, index, reference links, health report). **Do not edit Lua/JS.**

## Step 1 — Parse scope

After `memory health` (case-insensitive):

| Input | Scope | Fix |
|-------|-------|-----|
| `memory health` | all `memory/*.md` | no |
| `memory health fix` | all | yes |
| `memory health craft` | topic `craft` only | no |
| `memory health craft fix` | topic `craft` only | yes |

If no `memory/` files exist → reply suggesting `/fxmind learn <topic>` first; stop.

## Step 2 — Load context

| File | Purpose |
|------|---------|
| `.fxmind/memory-health.template.md` | Report structure |
| `.fxmind/memory.template.md` | Target compact format |
| `.fxmind/memory/_index.md` | Index integration |
| `.fxmind/topic-catalog.md` | Catalog orphans (info) |
| `.fxmind/reference.md` | Section `## Memórias por tópico` |
| `.fxmind/memory/<topic>.md` | Each topic to verify |
| `.fxmind/knowledge-graph.json` | If present — graph drift vs memories |

## Step 3 — Verify each memory (evidence required)

For every topic file, extract and validate:

### Paths
- Backtick strings that look like repo paths (`/`, `\`, or extensions `.lua`, `.js`, `.tsx`, `.json`, `.cfg`).
- Frontmatter `paths[]` entries — each must exist in repo.
- **Missing file** → Stale/Broken (critical if listed under `Files:` or `Recipe:`).

### Events / symbols
Grep repo for symbols mentioned in memory and frontmatter: `RegisterNetEvent`, `RegisterServerEvent`, `AddEventHandler`, `TriggerServerEvent`, `TriggerClientEvent` (quoted event names), `exports["..."]`, frontmatter `events[]`/`exports[]`/`symbols[]`, `vRP.*` / `QBCore.*` / `ESX.*` / `lib.*`, function names referenced in Recipe steps.
- **Zero matches** for a quoted event or export used as a step → Stale.
- **Zero matches** for primary handler/event in `Files:` or `Recipe:` → Broken.

### Frontmatter structure

| Issue | Flag |
|-------|------|
| Missing `lang: en-compact` | Token |
| Missing `confidence` | Token |
| `paths[]` / `events[]` / `exports[]` with zero grep matches | Stale/Broken |
| Arrays contain invented literals not in repo | Broken |

### Integration

| Check | Drift |
|-------|-------|
| `_index.md` row | topic in index but no `memory/<topic>.md` |
| `memory/*.md` file | file exists but missing from `_index.md` |
| `.fxmind/reference.md` table | link to missing memory file |
| `.fxmind/reference.md` | topic in memory folder but no row in `## Memórias por tópico` |

### Graph drift (when `knowledge-graph.json` exists)

| Check | Drift |
|-------|-------|
| Learned node in graph | no matching `memory/<id>.md` |
| `memory/*.md` topic | missing from graph learned nodes |
| Stale `generatedAt` | memories updated after graph `meta.generatedAt` |

If graph drift detected → recommend `/fxmind graph` refresh.

### Token format

| Issue | Flag |
|-------|------|
| Missing `lang: en-compact` in frontmatter | Token |
| > 60 lines (or < 10 with empty sections) | Token |
| PT-BR narrative sections (`Arquivos principais`, `Checklist`, `Anti-bugs`, `Memória —`) | Token |
| Long prose paragraphs (> 2 lines) | Token |
| Missing core sections: `Files`, `Recipe`, `Pitfalls` | Token |

**Verdict per topic:** `OK` | `Stale` (partial drift) | `Broken` (critical path/event missing).

## Step 4 — Write report

Save `.fxmind/memory-health.md` using `memory-health.template.md`: summary counts (OK / Stale / Broken / Integration / Token), per-topic table + detail blocks with grep evidence, integration section, recommended actions. Write report in **user's language**; memory files stay compact English.

## Step 5 — Fix mode (when `fix` in args)

Only after verification — **never invent** replacements:

1. **Prune** lines referencing missing paths/events (grep-confirmed dead refs).
2. **Rewrite** to `memory.template.md` — compact English, `lang: en-compact`, ~25–60 lines; refresh frontmatter arrays from surviving grep evidence.
3. **Re-scan** repo for that topic (catalog hints + surviving valid paths) to refresh `Files`, `Recipe`, `Example`, `Pitfalls`.
4. **Sync** `_index.md` and `.fxmind/reference.md` one-row links.
5. **Broken topics** mostly empty after prune → keep minimal stub + flag **re-learn**: `/fxmind learn <topic>` — do not guess new APIs.

Update frontmatter `updated` on changed memories.

## Step 6 — Reply

Reply in **user's language**: summary table (topics × verdict), path `.fxmind/memory-health.md`, auto-fixed topics (fix mode), topics needing `/fxmind learn <topic>` (manual), suggest `/fxmind graph` if memories changed.

## Memory health rules

- **Never invent** paths, events, or APIs.
- **Do not** edit Lua/JS — markdown only.
- Every finding needs **file evidence** or **grep result**.
- Fix mode optimizes **tokens** and **accuracy** — not a full codebase rescan unless topic is rescanned in step 5.
- Cursor Agent: use **AskQuestion** before deleting an entire topic memory; otherwise ask in chat.
