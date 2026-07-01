# fxmind — Mode: Update

Refresh **installed knowledge packs**, **Agent Skills**, **pack templates**, and the **`/fxmind` helper** when fxmind or pack skills changed upstream.

This mode runs the fxmind CLI — it does **not** edit memories, `memory/_index.md`, or `knowledge-graph.json`.

### Step 1 — Verify install

If `.fxmind/packs.json` is missing → tell user to run `npx github:fx-mind/fxmind -y` (or `fxmind -y` if installed globally) from the project root; stop.

### Step 2 — Run update CLI

From the **project root** (where `.fxmind/` lives), run in the terminal:

```bash
npx --yes github:fx-mind/fxmind --update -y
```

If fxmind is installed globally: `fxmind --update -y`.

Optional: `--target <dir>` when not in project root; `--agent cursor,claude` only if user wants to limit agents.

The updater: reads `.fxmind/packs.json`; pulls latest skills from the pack repo cache; re-copies pack skills into `.fxmind/skills/`; refreshes pack templates and core `/fxmind` templates + modes; removes legacy pack skills from agent skill folders; preserves `.fxmind/memory/*` and existing `knowledge-graph.json`.

### Step 3 — Confirm

Report stdout from the command. Remind user to restart the agent IDE/CLI (Gemini: `/commands reload`).

### Update rules

- **Do not** hand-edit skill folders when the CLI can refresh them.
- **Do not** delete or rewrite user memories during update.
- **Do not** enter Task/Learn/Audit modes during update.
