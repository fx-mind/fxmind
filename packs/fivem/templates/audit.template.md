# FiveM Audit — {{RESOURCE_OR_SCOPE}}

**Date:** {{DATE}}  
**Framework:** {{FRAMEWORK}}  
**Scope:** {{SCOPE_PATHS}}  
**Coverage:** Full resource (fxmanifest) | Single file only (state reason)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

> **Counts must match** the number of rows in the Findings tables (not grouped themes).

One-paragraph overview of the main risks and quick wins.

---

## Manager Events Matrix (§5.1)

| Event | File:line | SafeEvent | Real permission | Cooldown-only trap | Verdict |
|-------|-----------|-----------|-----------------|-------------------|---------|
| `manager:getGarages` | `server/adapter.lua:571` | ❌ | ❌ | — | **Critical** — data leak |

Or: **N/A** — no manager/admin events in scope.

**Systemic finding:** when multiple rows lack auth, one S* row listing all events + shared `CanManageResource(source)`.

---

## View Cache Matrix (§2.4 Pass 2)

| Row | Check | Found? | File:line | Severity |
|-----|-------|--------|-----------|----------|
| V-a | `build*` inside `TriggerClientEvent` args | | | High |
| V-b | `build*List()` in get/open handler | | | High |
| V-c | Double build (item + list same handler) | | | High |
| V-d | Triple sync (delta + list + `Load*Player`) | | | High |
| V-e | `Load*Player` on connect | | | High |
| V-f | `Load*Player` after CRUD + delta exists | | | High |
| V-g | Full `Load*Cache()` after one DB write | | | Medium |
| V-h | Duplicate transform / duplicate fn | | | Medium |
| V-i | Manual `ChunkTable` + `Wait` | | | Medium |
| V-j | Broadcast misuse (`manager:*` or large payload to `-1`) | | | High / Critical |

Mark **N/A** only when the resource has no caches/sync — explain why.

---

## Broadcast Matrix (§1.6.1)

| File:line | Event | Target | Payload | Verdict |
|-----------|-------|--------|---------|---------|
| `adapter.lua:668` | `manager:garageUpdated` | `source` | small | **OK** |
| `adapter.lua:61` | `garages:updateGarage` | `-1` | small world delta | **OK** |
| example | `manager:receiveGarages` | `-1` | full list | **Critical** — admin leak |

**Rules:** `manager:*` / admin UI → **`source` only**. `-1` only for **global gameplay** sync with **small** payload (< ~8 KB). Large or full cache → cerberus `SendFullSync` / `SendDeltaSync` (+ `range`, `scopeRadius`).

---

## Globals Table (§3.6)

| Symbol | Declared | Used in files | Verdict |
|--------|----------|---------------|---------|
| `GarageCache` | `adapter.lua:5` | `adapter.lua` only | → `local` |
| `GarageLocates` | `server.lua:184` | `server.lua`, `adapter.lua` | **OK** — cross-file server |

---

## Findings

### Security

| ID | Severity | File:line | Symbol | Issue | Recommendation |
|----|----------|-----------|--------|-------|----------------|
| S1 | Critical | `server/adapter.lua:571` | `manager:getGarages` | No server auth; leaks list with perms | `CanManageResource` before send |

Checklist:

- [ ] Manager events matrix complete
- [ ] Cooldown helpers not mistaken for permission
- [ ] SafeEvent on all mutating admin events
- [ ] No `manager:*` sent to `-1`

### Performance — View Cache

| ID | Severity | File:line | Symbol | Issue | Recommendation |
|----|----------|-----------|--------|-------|----------------|
| V-a | High | `adapter.lua:668` | `manager:updateGarage` | build-on-send | `ViewCache[id]` |
| V-j | Critical | `adapter.lua:???` | `manager:*` | `-1` on admin event | Use `source` only |

**Snippets (required for Critical/High):**

```lua
-- Admin UI: always source (§1.6.1)
TriggerClientEvent("manager:garageUpdated", source, ManagerGarageListCache[id])

-- World sync: small delta to all
TriggerClientEvent("garages:updateGarage", -1, WorldViewCache[id])

-- Large bootstrap: cerberus, not TriggerClientEvent(-1, hugeTable)
exports["cerberus"]:SendFullSync(source, "garages:fullSync", SanitizedGarageCache, {
    key = "garages:bootstrap",
    coords = GetEntityCoords(GetPlayerPed(source)),
    range = 150.0
})
```

### Performance — General

| ID | Severity | File:line | Issue | Recommendation |
|----|----------|-----------|-------|----------------|

### Patterns & Code Quality

| ID | Severity | File:line | Issue | Recommendation |
|----|----------|-----------|-------|----------------|

---

## Correction Plan

**Severity ↔ phase must match (§2.4 Pass 5).**

### Phase 1 — Critical security

1. [ ] S* — auth on all `manager:*`; SafeEvent on deletes
2. [ ] V-j — fix any `manager:*` or admin payload sent to `-1`

### Phase 2 — High (view cache + hot paths)

1. [ ] V-a–V-f — view cache layer; remove hot-path rebuilds
2. [ ] Large sync → cerberus instead of manual chunks (V-i)

### Phase 3 — Medium

1. [ ] V-g, V-h — incremental cache; dedupe functions; local globals

### Phase 4 — Low

1. [ ] ...

---

## Pass 6 Self-Check (§2.4)

- [ ] All fxmanifest Lua files in **Files reviewed**
- [ ] View cache matrix V-a–V-j each marked Found or N/A
- [ ] **Broadcast matrix** filled for every `TriggerClientEvent(-1, ...)` and large sync
- [ ] Summary counts = findings row counts
- [ ] Every finding has correct **symbol** and verified line
- [ ] Phase plan matches severities
- [ ] Before/after snippets for all Critical/High items

---

## Files Reviewed

| File | Lines | Side |
|------|-------|------|
| `fxmanifest.lua` | | — |

## Skills Referenced

- **fivem-skill** → `.fxmind/skills/fivem-development/best-practices.md` (§1.6.1, §2.2–2.4, §3.6, §4.2, §5.1)
- Framework skill: `{{FRAMEWORK_SKILL}}`

**Repo split:** patterns live in [fivem-skill](https://github.com/proelias7/fivem-skill); audit workflow lives in [fxmind](https://github.com/fx-mind/fxmind).
