# fxmind corrections

Feed of **agent mistakes corrected by humans** — separate from topic memories.

| Path | Role |
|------|------|
| `.fxmind/memory/` | Project knowledge (how this server works) |
| `.fxmind/corrections/` | Skill-improvement backlog (how agents should code) |

Use this folder to improve pack skills (`fivem-development/<category>.md`) via `/fxmind-judge` or manual PR.

## Commands

```bash
fxmind corrections list
fxmind corrections list --status open --category architecture
fxmind corrections add --title "..." --category style --bad "..." --good "..."
fxmind corrections export                 # markdown digest for skill editing
fxmind corrections export --format json
fxmind corrections promote <id>           # mark applied to skill
```

MCP: `fxmind_record_correction`, `fxmind_list_corrections`.

## Categories (map to skill sections)

| Category | Skill focus | Target file |
|----------|-------------|-------------|
| `architecture` | Monolith, file layout, globals, modules | `architecture.md` |
| `communication` | Tunnel / events / callbacks | `communication.md` |
| `security` | Auth, validation, SafeEvent | `security.md` |
| `performance` | Cache, broadcast, ticks | `performance.md` |
| `style` | Comments, naming, cleanliness | `style.md` |
| `api` | Wrong framework API / inventing calls | `api.md` |

## Split best-practices?

**Done in pack:** one `fivem-development` skill with thin `SKILL.md` + the files above. Do **not** register six separate agent skills.

## Workflow

1. User corrects agent → save memory Pitfall **and/or** `fxmind_record_correction`
2. Periodically: `fxmind corrections export` → edit `fivem-development/<category>.md`
3. `fxmind corrections promote <id>` when the rule is in that file
4. `fxmind --update` on projects to ship the skill
