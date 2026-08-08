--[[
  fxmind-nui-bridge (server) — receives NUI state dumps and writes:
    1) convar fxmind_nui_dump_path (set by `fxmind fivem install`)
    2) SaveResourceFile → last-dump.json (fallback for MCP)
]]

local RESOURCE = GetCurrentResourceName()

local function encode(payload)
  return json.encode(payload)
end

local function writeDump(payload)
  local encoded = encode(payload)
  if type(encoded) ~= "string" or encoded == "" then
    return false, "encode failed"
  end

  local dumpPath = GetConvar("fxmind_nui_dump_path", "")
  if dumpPath ~= "" then
    local ok, err = pcall(function()
      local f = io.open(dumpPath, "w")
      if not f then
        error("io.open failed: " .. dumpPath)
      end
      f:write(encoded)
      f:close()
    end)
    if not ok then
      print(("[fxmind-nui-bridge] path write failed: %s"):format(tostring(err)))
    end
  end

  local saved = SaveResourceFile(RESOURCE, "last-dump.json", encoded, #encoded)
  if not saved then
    print("[fxmind-nui-bridge] SaveResourceFile(last-dump.json) failed")
    return false, "SaveResourceFile failed"
  end
  return true
end

RegisterNetEvent("fxmind:nuiDump", function(payload)
  local src = source
  if type(payload) ~= "table" then
    return
  end

  local out = {
    ok = true,
    ts = os.time() * 1000,
    receivedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    player = src,
    reqId = payload.reqId,
    resource = payload.resource or "unknown",
    meta = type(payload.meta) == "table" and payload.meta or {},
    state = payload.state,
  }

  local ok, err = writeDump(out)
  if ok then
    print(("[fxmind-nui-bridge] dump ok resource=%s player=%s"):format(
      tostring(out.resource),
      tostring(src)
    ))
  else
    print(("[fxmind-nui-bridge] dump failed: %s"):format(tostring(err)))
  end
end)

--- Console / RCON: fxmind_nui_dump [resourceName]
RegisterCommand("fxmind_nui_dump", function(_src, args)
  local filter = args[1]
  local reqId = ("%s-%s"):format(os.time(), math.random(1000, 9999))
  TriggerClientEvent("fxmind:requestNuiDump", -1, {
    reqId = reqId,
    resource = filter, -- nil/empty = all wired resources respond
  })
  print(("[fxmind-nui-bridge] requested dump reqId=%s filter=%s"):format(
    reqId,
    filter and filter ~= "" and filter or "*"
  ))
end, true)
