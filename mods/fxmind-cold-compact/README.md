# fxmind-cold-compact

Claude Code mod from fxmind. When a prompt arrives in a session that sat idle past the prompt-cache window (cold) and holds a large context, the mod runs `/compact` first and then lets the prompt continue, so orchestrators that wake big sessions after a quota reset do not re-send the whole context uncached.

- On by default: 60 minutes idle, 80k tokens.
- `/fxmind-compact` opens a pane to turn it on/off and change the limits.
- Settings are shared with the fxmind CLI and web panel in `~/.fxmind/panel.json` (`panel.coldCompact`).
