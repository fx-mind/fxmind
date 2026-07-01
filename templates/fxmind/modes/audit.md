# fxmind — Mode: Audit

**Read-only analysis.** Do **not** edit code unless the user explicitly asks to implement fixes after reviewing the plan.

> **Output path (mandatory):** write the report to **`.fxmind/audits/<resource-name>.md`** only.
> **Forbidden:** `.fxmind/audit-<name>.md` or any `audit-*.md` in the `.fxmind/` root — use the `audits/` folder.

Audit the target Lua/JS resource(s) for **security**, **performance**, and **patterns**. Deliver a structured report + prioritized correction plan.

## Full procedure is external

The complete audit matrix (view-cache V-a..V-j, broadcast, globals, manager events, severity/phase, report sections, rules) lives in **`.fxmind/audit-procedure.md`** — **read it now** before continuing. It is intentionally kept out of the command body to save context on non-audit invocations.

If `.fxmind/audit-procedure.md` is missing, run `fxmind --update -y` (or `npx --yes github:fx-mind/fxmind --update -y`) to restore it, then retry. Do not improvise the matrix from memory.

## Audit scope

- `audit` alone → resource/folder from user `@` mention, open files, or ask which resource to audit
- `audit resources/[Novos]/myresource` → audit that path only
- `audit server.lua` → audit file if path exists

## Quick reference (the non-negotiables)

- Read the **full `fxmanifest.lua`** scope — never audit a single file unless explicitly scoped.
- Every finding cites `file:line` + the exact event/symbol — read the line before citing.
- Report every view-cache row V-a–V-j as **Found** or **N/A**; never skip.
- `manager:*` / admin events to `-1` → **Critical**; never recommend `TriggerClientEvent("manager:*", -1, ...)`.
- Cooldown (`CanUse*Manager` with `os.time()`) is **not** permission (§5.1).
- Severity→Phase: Critical→1, High→2, Medium→3, Low→4. Never downgrade.
- Summary counts must equal findings rows; Files reviewed = manifest paths only.
- Do not auto-fix; ask before implementing Phase 1.
