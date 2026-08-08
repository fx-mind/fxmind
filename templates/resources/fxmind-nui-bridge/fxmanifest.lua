fx_version "cerulean"
game "gta5"

name "fxmind-nui-bridge"
author "fxmind"
description "Dev-only NUI state dump bridge for fxmind MCP agents"
version "1.0.0"

server_script "server.lua"

-- Wire a NUI resource (fxmanifest):
--   client_script "@fxmind-nui-bridge/client-hook.lua"
-- Then register window.__FXMIND_GET_NUI_STATE__ in the NUI (see snippets/).
