---
name: fxmind-setup
description: Configure the FXMIND Agent Plugin for a coding project and verify shared memory and MCP connections.
---

# Set up FXMIND

Use this skill only for explicit FXMIND installation, upgrade or connection troubleshooting.

1. Identify the user's target project. Never assume the plugin directory is the project.
2. Require Node.js >=20.9 and an installed FXMIND runtime: `npm install -g github:fx-mind/fxmind` (ask before installing globally). Never put credentials in plugin manifests.
3. In the project, run `fxmind --agent cursor,claude,codex -y` (or chosen clients). This installs `.fxmind/`, project skills, guarded hooks, and per-project MCP settings. For an existing install prefer `fxmind --update -y`; preserve memories.
4. The bundled plugin MCP uses `FXMIND_TARGET` to select that project. Claude Code may also supply `CLAUDE_PROJECT_DIR`. Cursor/Codex need explicit project roots in the plugin MCP environment; never infer from the plugin directory.
5. Do not leave the same `fxmind` MCP enabled twice (bundled and project-level); use one connection per project.
6. Restart the client, list FXMIND tools, confirm the project and run a read-only memory query. Tool count varies by packs and enabled groups.
7. If the host cannot pass a reliable target, use the existing project-level MCP from the installer and retain the plugin skill. Report this limitation.

Do not apply Gates A/B/V/C merely to answer a simple question. Retrieve project memory only when relevant.
