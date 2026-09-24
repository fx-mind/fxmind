---
resource: {{RESOURCE}}
kind: create | refactor
status: draft | approved | built
framework: {{FRAMEWORK}}
updated: {{DATE}}
---

# {{RESOURCE}} — design

Compact English. Every row is a decision; "?" marks an open question for the user.

## Goal and Done

- Goal: one sentence.
- Done: observable behaviors (in-game flow, command, UI) that prove it works.
- Out of scope: ...

## Current contract (refactor only — the invariants)

| Kind | Name | Notes (kept / changed: why) |
|------|------|------------------------------|
| net event / callback / tunnel | `res:event` | kept |
| export | `exports.res:fn` | kept |
| command | `/cmd` | kept |
| DB table / query | `table` | kept |
| statebag key | `state.key` | kept |
| NUI message / callback | `action` | kept |
| config key | `Config.X` | kept |

## Files (minimal)

| File | Responsibility |
|------|----------------|
| `fxmanifest.lua` | ... |
| `shared/config.lua` | only values that change per server |
| `server/main.lua` | ... |
| `client/main.lua` | ... |

## State ownership

| Data | Owner | Storage | Replicated via (N5) | Read by |
|------|-------|---------|---------------------|---------|
| ... | server | DB + cache | entity statebag / on demand / none | ... |

## Network contract

| Event / callback | Direction | Recipients (N1) | Payload shape + est. size (N2/N3) | Frequency (N4) | Rate limit + validation (N6/C3) |
|------------------|-----------|-----------------|-----------------------------------|----------------|----------------------------------|
| ... | C→S | — | `{ id }` ~50 B | on click | 1/500 ms, owner check |

## Database (D1/D2)

| Table | Read when | Written when | Cache / flush |
|-------|-----------|--------------|---------------|
| ... | player join | dirty flush 60 s + drop + stop | cache-aside per player |

## Threads (T1/T2)

| Loop | Active when | Sleep | Could it be an event/handler instead? |
|------|-------------|-------|----------------------------------------|

## NUI (if any)

- Open/close flow, messages (client→NUI), callbacks (NUI→client→server), data pulled on open (N3).

## Security

- Per endpoint: permission, ownership, input limits, cooldown.

## Principles check

N1 … N6, D1 … D3, T1 … T2, C1 … C4: how each is honored or `n/a` (one line each).

## Build slices

1. Slice — files, what becomes runnable, how it is verified.

## Open questions

- ?
