# FXMIND Agent Plugin

This repository packages the existing FXMIND skill and MCP for the portable [Agent Plugins 1.0](https://agent-plugins.org/) format (Codex/Cursor), plus Claude Code compatibility. It does not replace the FXMIND engine or installer.

## Included

- `plugin.json` and `mcp.json` — portable manifest and MCP.
- `skills/fxmind/SKILL.md` — same contract as `templates/skills/fxmind/SKILL.md`.
- `skills/fxmind-setup/SKILL.md` — setup and verification.
- `.claude-plugin/plugin.json` and `.mcp.json` — Claude Code adapter.
- `.cursor-plugin/plugin.json` — Cursor adapter with `${CURSOR_PLUGIN_ROOT}` support (Cursor does not currently expand portable `${PLUGIN_ROOT}`).
- `scripts/plugin-mcp.js` — launcher that refuses to run in the plugin folder.

## Installation (CLI)

Install Node.js >=20.9 and the FXMIND runtime. Until this branch is merged into `main`, install its plugin CLI with:

```sh
npm install -g github:fx-mind/fxmind#feat/fxmind-agent-plugin
```

Then use the client you want (repeat for multiple clients):

```sh
fxmind plugin cursor
fxmind plugin claude
fxmind plugin codex
```

- **Cursor:** copies the Agent Plugin manifest + two skills to `~/.cursor/plugins/local/fxmind`. Restart Cursor or use **Developer: Reload Window**; verify in **Customize > Plugins**.
- **Claude Code:** creates a local FXMIND marketplace under `~/.fxmind/plugin-cli/marketplace` and installs the skills-only plugin via `claude plugin marketplace` / `claude plugin install`, with user scope. Requires `claude` on PATH.
- **Codex:** registers the same local marketplace with `codex plugin marketplace add` and installs `fxmind@fxmind-local` using `codex plugin add`. Requires `codex` on PATH. Re-running is idempotent at the installed version; if the installed version differs, the CLI explicitly instructs how to reinstall (to avoid silent deletion).

All three installs intentionally bundle **skills only**, not another MCP server or global gates. They can run without an initialized project. To enable shared memory and MCP in an individual project, run `fxmind --agent cursor,claude,codex -y` from that project (or `fxmind --update -y` for an existing installation). This preserves project memory and hooks. Keep the existing **single project-level MCP registration**.

The full repository also retains the portable plugin MCP for controlled/manual installations. If using that alternative, set `FXMIND_TARGET` explicitly and disable the duplicate project-level MCP; do not commit machine-specific paths. For any client, restart the agent and verify the expected tools with a read-only `fxmind_list_memories` or `fxmind_query` call. Tool counts depend on packs and configuration.

### Explicit project selection

Portable plugin managers launch stdio servers from the plugin directory, which may not be the user's workspace. To avoid putting memory or gate state in the wrong location, the bundled launcher fails closed when it cannot resolve an initialized target project. For hosts without per-project environment injection, use FXMIND's existing project-level MCP configuration.

### Runtime and hooks

A plugin installed from a bare Git checkout does not include `node_modules`. The launcher uses dependencies from `npm ci` in the checkout or a global FXMIND runtime, and reports missing dependencies without downloading anything during the MCP handshake.

Cursor hooks and gates remain project-scoped through `fxmind` CLI. Global hooks could activate task gates for unrelated questions; they are intentionally not bundled by this portable plugin.

## Development

Run `npm ci` then `npm test`. `scripts/plugin.test.js` validates manifests, skill sync, target selection and launcher behavior. Smoke-test a fresh session in Codex, Cursor and Claude before public marketplace publication. Public local-stdio plugin submission can require provider approval.
