local function playerDropped()
  syncDatatableNeeds()
end

AddEventHandler("playerDropped", playerDropped)

local function syncDatatableNeeds()
  return true
end
