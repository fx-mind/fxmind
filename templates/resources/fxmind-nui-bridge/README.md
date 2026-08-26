# fxmind-nui-bridge

Dev-only bridge so Cursor/fxmind agents can read **structured NUI state** (better than screenshots).

## Agent lifecycle (preferred)

The agent configures and removes wiring itself:

```bash
fxmind fivem nui-wire <resource>     # MCP: fxmind_fivem_nui_wire
fxmind fivem ensure fxmind-nui-bridge
fxmind fivem ensure <resource>
# open NUI in-game
fxmind fivem nui-dump --resource <resource>
fxmind fivem nui-unwire              # MCP: fxmind_fivem_nui_unwire (mandatory)
```

`nui-wire` adds marked blocks to `fxmanifest.lua` + injects `fxmind-nui-probe.js` into the `ui_page` HTML. `nui-unwire` removes those markers/files.

## Install

Copied by `fxmind fivem install` into `resources/[local]/fxmind-nui-bridge` (or `resources/fxmind-nui-bridge`).

```cfg
ensure fxmind-nui-bridge
set fxmind_nui_dump_path "<abs>/.fxmind/state/nui-dump.json"
```

## Optional permanent wire

Only if you want dump without TEMP probe:

```lua
client_script "@fxmind-nui-bridge/client-hook.lua"
```

```ts
import { registerFxmindNuiDump } from "./registerNuiDump";
useEffect(() => registerFxmindNuiDump(() => useStore.getState()), []);
```
