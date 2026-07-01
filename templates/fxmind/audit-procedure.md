# fxmind — Audit procedure (loaded on demand)

This file is installed at `.fxmind/audit-procedure.md` and read **only** when the
agent runs `/fxmind audit`. It is intentionally kept out of the main `/fxmind`
command body to save context on every other invocation.

The audit itself stays **read-only**. Do not edit code unless the user explicitly
asks to implement fixes after reviewing the plan.

> **Output path (mandatory):** write the report to **`.fxmind/audits/<resource-name>.md`** only.
> **Forbidden:** `.fxmind/audit-<name>.md` or any `audit-*.md` in the `.fxmind/` root — use the `audits/` folder. Read `.fxmind/audits/README.md` if present.

Audit the target Lua/JS resource(s) for **security**, **performance**, and **patterns**. Deliver a structured report + prioritized correction plan.

> **Assertiveness:** Follow **`best-practices.md` §2.4** (mandatory passes), **§2.5** (quality gates), **§1.6.1** (broadcast), **§5.1** (manager events). Incomplete matrix, invented files, or wrong summary counts = **redo audit**.

## Step 1 — Load standards

Read from **`.fxmind/skills/`** (installed from [fivem-skill](https://github.com/proelias7/fivem-skill) via fxmind pack):

| Skill file | Sections |
|------------|----------|
| `fivem-development/best-practices.md` | **§1.6.1** broadcast, §2.2–**§2.5**, §3.6, **§4.2**, **§5.1** |
| Framework skill (`vrp-framework`, etc.) | If detected |
| `fivem-react-nui/ui-guide.md` | If scope includes NUI/web |

Read **`.fxmind/audit.template.md`** for report structure.

If **`.fxmind/reference.md`** exists at project root → read for project-specific conventions.

## Step 2 — Discover scope (full resource — Pass 0)

1. Resolve target resource folder from `$ARGUMENTS` or user `@` mention
2. Read **`fxmanifest.lua`** — enumerate **all** script paths
3. Read **every** `server/**/*.lua`, `client/**/*.lua`, `shared/**/*.lua`, and NUI scripts listed in the manifest
4. Do **not** stop at the file the user mentioned unless they explicitly scoped to that file only
5. Grep for high-risk patterns:

```text
RegisterNetEvent / RegisterServerEvent / AddEventHandler
RegisterNUICallback
TriggerServerEvent / TriggerClientEvent
exports["cerberus"]
SafeEvent / SetCooldown
SendFullSync / SendDeltaSync
exports["cacheaside"]
while true do Wait(0)
TriggerEvent(  (same-environment abuse)
build.*ListItem|build.*Item.*TriggerClientEvent
Sanitize.*Cache|ChunkTable|CHUNK_SIZE|Load.*Player
Get.*SummaryList|Get.*List\(
Load.*Cache\(
json\.decode
MySQL / oxmysql / exports.oxmysql
^[A-Z][A-Za-z0-9_]*\s*=  (top-level globals — verify cross-file use)
TriggerClientEvent\(-1
SendFullSync|SendDeltaSync
RegisterNetEvent\("manager:|RegisterNetEvent\("admin:
CanUse.*Manager|CanManage|hasGroup|hasPermission|SafeEvent
playerConnect|playerJoining|playerSpawned
```

6. **View cache matrix (§2.4 Pass 2)** — mandatory; document every row **V-a through V-j** as found or N/A:

   a. Grep **every** `build*`, `Sanitize*`, `Get*List`, `Get*Summary*`, `Load*Player`, `Load*Cache`, `ChunkTable`.
   b. For **each** caller: read enclosing handler name; record `file:line` + symbol.
   c. Grep **`Get.*SummaryList`** and **`build.*List`** — list **all** call sites in V-b detail (not only the first).
   d. Explicitly search: `TriggerClientEvent\([^)]*build`, same-handler double build, CRUD + count **every** sync line (`Load*Player`, `Send*Update`, manager events, world delta).

7. **Broadcast matrix (§1.6.1)** — grep every `TriggerClientEvent(-1, ...)` and large sync path:

   a. Record event name, target, estimated payload size.
   b. **`manager:*` / admin / panel events to `-1`** → **Critical** (admin leak).
   c. **Large table / full cache to `-1`** without cerberus → **High** — recommend `SendFullSync` / `SendDeltaSync` + scope.
   d. **Small world delta to `-1`** (id, coords, delete) → **OK** — do not flag.
   e. **Never recommend** `TriggerClientEvent("manager:*", -1, ...)` in fix snippets.

8. **Globals pass (§3.6 Pass 3)** — build **Globals table** for every top-level global in server scope, then client scope.

9. **Manager events pass (§5.1 Pass 4)** — build **Manager events matrix** for every `manager:*` / admin event.

10. **Pass 6 + Pass 7 self-check** — complete §2.4 Pass 6 and **§2.5 quality gates** before writing report.

## Step 3 — Evaluate (evidence required — Pass 1)

Every finding **must** cite `file:line` **and** name the exact **event/function symbol**. Read the line before citing — never attribute a pattern to the wrong handler.

### Security — manager / admin (§5.1)

- Any `manager:*` / admin event without **real** server permission (`hasGroup`, etc.)
- **Do not** treat cooldown-only helpers (`CanUse*Manager`, rate maps by `source`) as permission
- Missing `SafeEvent` on create/update/delete — compare siblings in same resource
- Read events (`get*`, `list*`) leaking config/perms/coords without auth → **Critical**
- `teleport*` admin actions without permission

Report as **systemic finding** when multiple events share the same missing auth pattern.

### Security — general
- Client/NUI data used without server re-validation
- Repetitive client/NUI actions without `cerberus` `SetCooldown` before `TriggerServerEvent`
- Missing permission checks (`hasGroup`, `hasPermission`, job checks)
- `source = -1` flood risk on server events
- SQL built from unsanitized client strings
- Webhooks/tokens in client or shared files exposed to NUI

### Performance — view cache & hot-path rebuild (§2.2–2.4)

Report **separate findings** for each matrix row hit (V-a through V-i):

- **V-a** `build*` inside `TriggerClientEvent` argument
- **V-b** `build*List()` / `Get*Summary*()` — **every** call site with `file:line`
- **V-c** double build (item + list same handler)
- **V-d** redundant sync storm — list **each** send in CRUD handler (manager + list + `Load*Player` + world delta)
- **V-e** `Load*Player` on connect/bootstrap
- **V-f** `Load*Player` after single CRUD when delta exists
- **V-g** full `Load*Cache()` after one DB write
- **V-h** duplicate transform / duplicate function definitions
- **V-i** manual chunk + `Wait` loop
- **V-j** `TriggerClientEvent(-1, ...)` on admin/manager events or large payload without cerberus (§1.6.1)

### Performance — broadcast (§1.6.1)

- `manager:*` / admin UI sent to `-1` → **Critical**
- Full cache / large table via `TriggerClientEvent(-1, ...)` → **High** — use cerberus
- Manual chunk to all players when cerberus exists → **Medium** (also V-i)

### Performance — general

- `Wait(0)` / tight loops without dynamic sleep
- Callbacks/Tunnel where events would suffice (no return needed)
- Callbacks or `TriggerServerEvent` inside loops < 5s interval
- Same-side `TriggerEvent` instead of direct function call
- Repeated DB queries without `cacheaside`
- Large table payloads sent manually without cerberus `SendFullSync` / `SendDeltaSync`
- Large table payloads over network (> ~8KB risk)

### Patterns & clean code (§3.5–3.10, §1.3)

- Over-split fxmanifest (many server/client files for one resource)
- **Unnecessary globals** — top-level symbol not read by any other file in same scope (§3.6); verify via fxmanifest scope before flagging
- Duplicated logic (same `json.decode`/normalize in multiple functions)
- Comment noise, state declared mid-file
- Long if/elseif chains where lookup table fits
- Missing nil guards on concatenation
- **Thin event wrappers** — `local function foo() TriggerEvent(...) end` with no other logic (inline the event or merge into a real helper)
- **Same-side `TriggerEvent`** when a local function in the same file could be called directly
- **Rebuild-on-send** — `TriggerClientEvent(..., buildItem(id, rawCache))`; pre-build view cache on load/CRUD (§2.2–2.3)

### Correction plan — view cache findings

For each §2.3 finding in the report, the plan must include:

1. **New caches** — name `SourceCache` / `ViewCache` / optional `ViewListCache`
2. **Rebuild hooks** — where to call `rebuildViewItem(id)` / `rebuildViewAll()` (load, create, update, delete)
3. **Send sites** — replace hot-path `build*` calls with cached references; on **delete**, nil view cache entry
4. **Delta vs full** — remove redundant `Load*Player` when delta exists; large bootstrap → cerberus not `TriggerClientEvent(-1)`
5. **Broadcast** — admin/manager → `source`; world small delta → `-1`; world large → cerberus + scope
6. **Minimal snippet** — before/after for the worst caller (`file:line`); **never** `manager:*` with `-1` in fixes

Do not recommend a full rewrite — smallest change that stops hot-path rebuild.

### NUI (when applicable)

- NUI callbacks without `cb("{}")` or valid JSON
- Repetitive client/NUI actions without local cooldown/debounce
- Heavy UI libraries (MUI, framer-motion, etc.)

### Severity

| Level | When |
|-------|------|
| **Critical** | Exploit / CRUD or data leak without server auth / free items or money / crash / ban bypass |
| **High** | Hot-path rebuild, full resync on delta, serious perf regression |
| **Medium** | Full DB cache reload, duplicate code, unnecessary global |
| **Low** | Style, minor perf, polish |

**Phase alignment (§2.4 Pass 5):** Critical → Phase 1; High → Phase 2; Medium → Phase 3; Low → Phase 4. Never downgrade.

## Step 4 — Write report

Create **`.fxmind/audits/`** if missing. Save to **`.fxmind/audits/<resource-name>.md`** (e.g. scope `garages` → `.fxmind/audits/garages.md`).

**Forbidden:** do not write `.fxmind/audit-<name>.md` at the `.fxmind/` root.

Use structure from `audit.template.md` — **required sections:**

1. Summary table — **counts must equal findings rows**
2. **Manager events matrix** (or N/A)
3. **View cache matrix** (rows V-a–V-j: Found / N/A)
4. **Broadcast matrix** (§1.6.1) — every `-1` send reviewed
5. **Globals table** (Symbol | Declared | Used in | Verdict)
6. Findings tables: Security, Performance (V-a…V-j), Patterns, NUI
7. **Correction plan** — phased; severity must match findings
8. **Files reviewed** — **only** manifest script paths (+ NUI if scoped); line count each
9. **Pass 6 + Pass 7 self-check** — all boxes ticked (§2.4 + §2.5)

Write report in **Portuguese** if codebase/comments are PT-BR; otherwise match project language.

## Step 5 — Reply to user

In chat, provide:

- Short executive summary (3–5 bullets)
- Count of findings by severity + **files reviewed** (must match fxmanifest)
- Mention if view-cache matrix or manager matrix had hits
- Top 3 fixes by priority
- Path to full report: `.fxmind/audits/<name>.md`
- Ask: *"Quer que eu implemente o Phase 1?"* (or equivalent) — **wait for approval before editing code**

## Audit rules

- **Never invent** findings — read `file:line` before citing; wrong handler = failed audit
- **Never treat cooldown as permission** — `CanUse*Manager` with only `os.time()` is rate-limit, not auth (§5.1)
- **Never audit one file** when user scoped the resource — read full `fxmanifest` unless explicitly single-file
- **Never recommend `TriggerClientEvent("manager:*", -1, ...)`** — admin UI → `source` only (§1.6.1)
- **Never use `TriggerClientEvent(-1, largeTable)`** in fixes — cerberus `SendFullSync` / `SendDeltaSync` + scope (§4.2)
- **Never skip view-cache matrix rows** — report each V-a–V-j as found or N/A
- **Never mismatch severity and phase** — High findings go to Phase 2, not Phase 3
- **Never list files not in `fxmanifest`** in Files reviewed (§2.5)
- **Never guess summary counts** — count Findings rows; grep before "N events use cooldown" (§2.5)
- **Never report only first V-b caller** — grep all `build*List` / `Get*Summary*` sites (§2.5)
- **Do not** auto-fix during audit mode
- Prefer concrete **before/after** snippets for every Critical/High finding
- **Do not** write audit reports outside `.fxmind/audits/`
- **Do not recommend** creating a function whose body is only `TriggerEvent(...)` / `TriggerServerEvent(...)` — inline at call site, or expand into a helper that also closes NUI/camera/state (see best-practices §1.3)
- **Do not recommend** `TriggerEvent` for logic that already exists as `local function` in the same file — call the function directly
- When a fix needs a cross-resource hook (e.g. `login:Spawn`, `hookSelector`), show the **inlined** `TriggerEvent` in the plan, not a one-line wrapper alias
