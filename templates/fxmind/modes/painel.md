# fxmind — Mode: Painel



Open the local FxMind web panel: **one chat screen**, an active folder, local `.fxmind` memories in every run, and answers from a **CLI on your machine** (OpenCode, Claude Code, Hermes, or Cursor Agent).



Do **not** ask for `CURSOR_API_KEY`. Do **not** require this Cursor chat as the worker unless the user explicitly wants the host loop.




## 1. Open the panel



From any directory (or the project root):



```bash

fxmind painel

```



If `fxmind` is not on PATH:



```bash

npx --yes github:fx-mind/fxmind painel

```



The CLI binds **localhost only** (`127.0.0.1:3847`), opens the browser at `/chat`, and reuses an instance already running if present.



Reply once with the URL (`http://127.0.0.1:3847/chat`).



## 2. Open the project folder



In the panel header, click the folder name → **Abrir pasta** (native dialog). If the dialog fails, paste the path to the repo that contains `.fxmind/`.



Recent folders are saved in `~/.fxmind/panel.json`.



## 3. Configure the CLI (first time)



**Settings → Execução e modelo**



- Pick an installed CLI (default order: OpenCode → Claude → Hermes → Cursor Agent).

- **Testar** / **Reescanear PATH** as needed.

- Cursor Agent: run `agent login` in a terminal if the card shows login required.

- Optional BYOK keys for providers that read env vars.



Each message builds a compact context file (`memory/_index.md` + graph query hits, **no synchronous graph rebuild**) and passes it to the selected CLI in the project cwd.

**Ferramentas FxMind (obrigatório):** o agente deve usar **somente MCP fxmind** para descoberta, gates, grafo, FiveM e DB — é o caminho otimizado para entrega rápida. Grep/busca manual no repo é proibido para Gate B.

### Task modes (composer)

- **Rápido** — injects `PANEL_MODE: quick` in the context file: trivial auto A+B, lighter Gate V/C, no subagent fan-out.
- **Completo** — `PANEL_MODE: full`: full fxmind pipeline; OpenCode may parallelize Gate B via subagents.

## 4.1 Task execution and review

New conversations run directly in the selected project directory, without creating a
git worktree. Tasks may be paused/resumed from the panel. A completed task enters
`review`; its diff shows the current repository changes. **Approve** commits those
changes on the current branch, and **Push** publishes the current branch. Existing
threads that already have a worktree continue using it.

For an interactive choice, a CLI must emit a fenced block with valid JSON:

````text
```fxmind-ask
{"question":"Which target?","options":[{"id":"server","label":"Server"},{"id":"client","label":"Client"}],"multi":false}
```
````

The panel changes the task to `waiting`. Answer it with the selected option IDs;
multi-choice questions may contain more than one ID. Malformed blocks remain ordinary
assistant text and do not block the task.



## 4. Use the chat



- Empty state: shortcuts (explore, create, review, fix).

- Composer chips: folder, CLI name, git branch, memory count.

- **Histórico** drawer: parallel threads.

- **Inbox** drawer: PortSpace demands (connect in Settings if needed).



## Optional: host loop (advanced)



If the user wants **this** chat to drain the panel queue instead of local CLIs, call `fxmind_panel_wait` / `fxmind_panel_reply` in a loop. That path is secondary; the default is CLI local.



## Reply



First line: the panel URL. Then brief steps: open folder, pick CLI in Settings, send a message.
