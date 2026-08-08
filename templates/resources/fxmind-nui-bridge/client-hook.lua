--[[
  Include in any resource that owns a ui_page:

    client_script "@fxmind-nui-bridge/client-hook.lua"

  NUI must define:
    window.__FXMIND_GET_NUI_STATE__ = () => ({ ...serializable state })
  Optional:
    window.__FXMIND_GET_NUI_META__ = () => ({ route, visible, ... })
]]

local RES = GetCurrentResourceName()

RegisterNetEvent("fxmind:requestNuiDump", function(req)
  if type(req) ~= "table" then
    return
  end

  local filter = req.resource
  if type(filter) == "string" and filter ~= "" and filter ~= RES then
    return
  end

  SendNUIMessage({
    action = "fxmind:nuiDump",
    reqId = req.reqId,
    resource = RES,
  })
end)

RegisterNUICallback("fxmindNuiDump", function(data, cb)
  if type(data) ~= "table" then
    cb({ ok = false, error = "invalid payload" })
    return
  end

  data.resource = data.resource or RES
  TriggerServerEvent("fxmind:nuiDump", data)
  cb({ ok = true })
end)

--- Manual in-game: /fxmind_nui_push  (dumps this resource only)
RegisterCommand("fxmind_nui_push", function()
  SendNUIMessage({
    action = "fxmind:nuiDump",
    reqId = ("push-%s"):format(GetGameTimer()),
    resource = RES,
  })
end, false)
