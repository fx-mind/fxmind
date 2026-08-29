# fxmind — Mode: Painel

Open the local FxMind web panel in the browser (inbox, chat with the agent, memories, query, gates).

**Always shell out** — do not invent a different URL or start a second server stack.

## Run

From the project root (where `.fxmind/` lives):

```bash
fxmind serve --open --path /chat
```

If `fxmind` is not on PATH:

```bash
npx --yes github:fx-mind/fxmind serve --open --path /chat
```

If `web/dist` is missing, run `npm run build:web` inside the fxmind package, then retry.

The CLI binds **localhost only** (`127.0.0.1:3847`). If the panel is already running, it reuses that process and just opens the browser.

## Reply

One line: the URL that opened (`http://127.0.0.1:3847/chat`). Do not enter Task/Learn/Audit. Do not edit project source.

Remind: demandas do dia ficam no Inbox do painel; clicar injeta no chat (várias em paralelo). Agente do painel usa `CURSOR_API_KEY` (settings do painel ou env).
