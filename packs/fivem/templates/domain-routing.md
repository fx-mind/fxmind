# Domain routing — FiveM

- FiveM: `.fxmind/policy/fivem-principles.md` is binding for every change (scope/payload/chunks/statebags/anti-flood, no DB in hot paths, minimal code); then `fivem-development/quality-gates.md` rows for the touched artifacts and relevant references.
- Framework calls: the matching vRP, QBCore, Qbox or ESX skill.
- NUI/React: `fivem-react-nui/SKILL.md`.

FiveM dev tools: status before ensure/restart/tail; use tools yourself when available. Missing runtime blocks runtime verification. NUI wire/dump must be unwired before final validation; CEF visuals require in-game evidence. Respect real DB mutation boundaries and never invent approval.
