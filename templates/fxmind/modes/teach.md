# fxmind — Mode: Teach (playbook)

Turn a task that **just worked** into a playbook: the exact files, anchors and snippets for a repeated request, so the next run skips discovery. Also used to fix a stale playbook. Playbooks live in `.fxmind/playbooks/<id>.md`; memories stay the context (what/why), playbooks are the procedure (what to do).

Do not implement code in this mode. Read-only except the playbook file.

## When

- `/fxmind teach <name>` after a finished task, or with the instruction typed by the user ("para cadastrar skin de arma, edite X, adicione Y").
- Gate C suggested it (same kind of task done again on the same files).
- A playbook was reported stale (anchor or file missing).

Only `kind: config` (data/config entries) or a diagnostic checklist for `fix` make good playbooks. Do not write playbooks for mechanics or new resources.

## Steps

1. **Source of truth = a diff that passed Gate V.** `git diff` / `git show` of the task, or the user's instruction when no task ran (then status stays `draft` and every anchor must be verified by reading the file).
2. **Id and triggers.** `id` = slug (`add-weapon-skin`). `triggers[]` = the phrases users type, PT-BR first (`cadastrar skin`, `adicionar skin de arma`). Each trigger needs ≥2 significant words (verb + object); one-word triggers never match. Actions are synonyms (cadastrar/adicionar/criar/registrar), so one phrase per object is enough.
3. **Steps.** One line per edited location, in edit order:
   `N. \`path\` @ \`anchor\` — instruction`, optionally followed by a fenced snippet with the inserted text.
   - **Anchor = a stable line of text** already in the file (a table header, a neighbouring entry's key). Never a line number. Use `{{name}}` inside an anchor for a variable part (`ConfigWeapons.Items.{{scope}} = {`).
   - Snippet: replace variable parts with `{{input}}` placeholders; keep repo literals verbatim.
   - Add a step for every validation read the task needed (e.g. "confirm `originalModel` exists in `itemlist.lua`") so the next run does not rediscover it.
4. **Inputs.** Each `{{placeholder}}` becomes one bullet `- name — hint` (where the value comes from, constraints, default).
5. **Verify.** The observable checks the task used at Gate V (ensure + console, in-game flow). Same standard as `task-verify.md`.
6. **memories[].** Slugs of the related memories; their `Pitfalls` are appended automatically when the playbook loads. Do not copy them into the playbook.
7. **Write** `.fxmind/playbooks/<id>.md` from `.fxmind/templates/playbook.md`: `status: draft`, `updated` today. It becomes `verified` by itself the first time a task using it closes Gate C.
8. **Check.** Run `fxmind playbooks check <id>` (MCP `fxmind_playbook` action `check`): every file and anchor must resolve. Fix errors before finishing. Then `fxmind playbooks match "<a real request>"` must select it.

## Rules

- One playbook per repeated request; update the existing one instead of creating `add-weapon-skin-2`.
- Never invent paths or anchors — every one must be read from the repo.
- Keep it short: steps and snippets only. Explanations belong in the memory.
- When a run deviated from the playbook (extra file read, wrong anchor), fix the playbook now — that deviation is the improvement.

Reply in the user's language: playbook path, the trigger phrases, and one line on how to use it.
