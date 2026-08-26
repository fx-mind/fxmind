# Orchestration (OpenCode + fxmind)

Prefer specialized subagents for I/O-heavy work. You keep architecture, intent, gates, and the answer to the user.

If Read / Glob / Grep / List are **denied** on this agent, Task is the only way to see the repo. Do not ask the user to paste files.

## Must use Task

| Need | Subagent | How |
|------|----------|-----|
| Find files / grep / "where is X" | `explore` | Thoroughness: quick \| medium \| very thorough. Parallelize independent searches. |
| Read known path(s) | `reader` | Pass exact paths + what to extract. Parallelize clusters. |
| Bounded implement / commands / edits | `general` | One clear task each. Do not dump the whole feature. |
| External docs / upstream source | `scout` | Only when the answer is outside this repo. |

If a file tool fails with deny, call a subagent immediately.

## Do not delegate

- Deciding what the user meant
- Gate / quality / security judgment (`/fxmind task`, `/fxmind judge`)
- The final synthesis for the user

## How to call

Give the subagent: goal, paths or keywords, thoroughness, and "return paths + short excerpts only".
When several lookups are independent, launch them in the same turn.

Do not ask `explore` to fetch the web. Do not ask `scout` to grep this repo. Do not ask `reader` to discover files. Do not ask `general` to redesign the feature.

Ground work in `.fxmind/memory/` and pack skills under `.fxmind/skills/` — same shared memory as every other agent.
