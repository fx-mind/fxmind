# FiveM principles — binding for every FiveM change

Short rules with IDs. Cite the IDs in Gate A/B notes and in the Gate V `review` ("N1 N2 D1 ok; N3 n/a"). Details and examples live in `.fxmind/skills/fivem-development/` (`SKILL.md` maps each ID to its sections); this file decides.

## Network — who receives what

- **N1 Scope first.** Before writing any `TriggerClientEvent`, name the recipient set: `source` > explicit list (owner, group members, same job, same routing bucket, players in range) > `-1` only for rare, truly global changes. Never `-1` for per-player, per-area or privileged (`manager:*`, admin) data.
- **N2 Minimal payload.** Send ids, deltas and changed fields — never whole tables the client already has, can derive, or will not render. No server-formatted UI strings. Callback/tunnel returns count too.
- **N3 Big data in pieces.** Lists that grow with players/items, or payloads above ~8–16 KB: the client pulls pages on demand (when the UI opens, per page/tab); bulk server→client delivery goes through cerberus `SendFullSync`/`SendDeltaSync` when the project has it, otherwise `TriggerLatentClientEvent(name, target, bps, ...)`. Never one giant event, never a hand-written chunk loop with `Wait`.
- **N4 No periodic fan-out.** No loop that sends to all players on a timer. Replicate state instead (N5) or push only on change, only to N1 recipients.
- **N5 Sync through the client.** Before adding a server event to share one player's/entity's state with others, check whether clients can read it themselves: small flags/ids/enums in `Entity(ent).state` or `Player(serverId).state` (set on change only), natives (coords, vehicle, health, animation). React with `AddStateBagChangeHandler`, not polling. Statebags carry small state, never payload tables (those follow N3). `GlobalState` only for tiny, rarely changing global flags. Server-only values: `state:set(key, value, false)`.
- **N6 Anti-flood.** Every client→server event and callback: server-side per-source cooldown (cerberus `SafeEvent` when installed) + validation; the client debounces UI actions and never fires events inside frame loops. Batch repeated actions into one call.

## Server & database

- **D1 No DB in hot paths.** Never query or write the DB inside loops, ticks, frequent events, per-player iterations or repeatable NUI callbacks. Load on join/first use into a cache (`cacheaside` when installed; invalidate in the mutating action); write-behind: mark dirty, flush in batches on interval, `playerDropped` and `onResourceStop`.
- **D2 One round-trip per operation.** No N+1: batch with `IN (...)`/joins, prepared statements, only the columns used.
- **D3 Server owns truth.** Money, items, permissions and progress are decided and validated on the server; the client only requests.

## Threads

- **T1 Event-driven first.** Prefer events, statebag handlers, target/zone callbacks over loops. A needed loop uses dynamic sleep: `Wait(1000+)` idle, `Wait(0)` only while the player is near/UI is open.
- **T2 No server-wide per-tick work.** No server loop over all players doing work every tick; per-player timers or on-demand checks.

## Code — minimal and readable

- **C1 Minimal code.** Smallest change that meets Done; reuse the resource's existing patterns. A new function must be reused or mark a real boundary (event handler, cache, validation, lifecycle). No single-use wrappers, forwarding helpers, generic managers, or config for values nobody changes.
- **C2 Readable flow.** Domain names, early returns, `local` everything, no globals, no deep nesting, no clever metatables. One file per side (`shared/config`, `server`, `client`, `nui`) unless size demands a split by domain — never a `utils` dump.
- **C3 Validate once at the boundary.** Type/range/ownership/permission checks at the event entry, not repeated inside helpers.
- **C4 Clean diff.** No debug prints, commented-out code, dead code or unrelated formatting.

## Review question for every artifact

For each new event, callback, loop, query, statebag and function: who receives it (N1), how big is it (N2/N3), how often does it run (N4/T1), does it touch the DB (D1), could the client read it itself (N5), and would the code be shorter without it (C1)?
