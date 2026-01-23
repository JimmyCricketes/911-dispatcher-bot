--[[
	CarSpawner Server Script
	Place in: ServerScriptService
]]

local Players = game:GetService("Players")
local InsertService = game:GetService("InsertService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local PhysicsService = game:GetService("PhysicsService")
local CollectionService = game:GetService("CollectionService")

local MIN_ADMIN_LEVEL = 100
local SPAWNED_TAG = "SpawnedVehicle"
local LOCK_SOUND_ID = "rbxassetid://92065430579470"

local VEHICLES = {
	{name = "Monarch Fleet Cruiser PPD Variant 2", assetId = 97431211012617, category = "Police"},
	{name = "Monarch Fleet Cruiser PPD Variant 1", assetId = 129159527829302, category = "Police"},
	{name = "Walton LodeMaster PPD Van", assetId = 84446437884168, category = "Police"},
	{name = "Monarch Fleet Cruiser Unmarked Fedwagon", assetId = 129177125763828, category = "Police"},
	{name = "State Patrol Cruiser", assetId = 109757959483681, category = "Police"},
	{name = "AM General M35A2", assetId = 102399689018758, category = "Police"},
	{name = "DoC FD Vehicle", assetId = 102896178826058, category = "Fire Department"},
	{name = "FD Vehicle w/ Backseats", assetId = 98419828764304, category = "Fire Department"},
	{name = "McNally Ambulance", assetId = 70949604368010, category = "Fire Department"},
	{name = "Civil Defense Van", assetId = 105893678264580, category = "Civil Defense"},
	{name = "1949 Cadillac Series 62", assetId = 131644545699202, category = "Civilian"},
	{name = "Monarch Empire Coupe", assetId = 92889112322436, category = "Civilian"},
	{name = "Durant Commander", assetId = 108852500162301, category = "Civilian"},
	{name = "Chevy Bel Air Red", assetId = 127607686507011, category = "Civilian"},
	{name = "Monarch Fleet Cruiser Blue", assetId = 139491405466406, category = "Civilian"},
	{name = "Chevy Bel Air Baby Blue", assetId = 73302282129507, category = "Civilian"},
	{name = "Monarch Fleet Cruiser Brown", assetId = 95184892753685, category = "Civilian"},
	{name = "Monarch Fleet Cruiser Cab", assetId = 74803270752791, category = "Civilian"},
	{name = "Public Works Van", assetId = 97779665304852, category = "Other"},
}

local activePreviews = {}
local vehicleConnections = {}

pcall(function()
	PhysicsService:RegisterCollisionGroup("VehiclePreviews")
	PhysicsService:CollisionGroupSetCollidable("VehiclePreviews", "Default", false)
end)

-- Wait for Adonis Plugin API
local MIN_ADMIN_LEVEL = 100
local adminAPI = nil

local function getAdminAPI()
	if adminAPI then return adminAPI end
	local folder = ReplicatedStorage:WaitForChild("AdonisAdminAPI", 30)
	if folder then
		adminAPI = folder:FindFirstChild("GetAdminLevel")
	end
	return adminAPI
end

local function isAdmin(player)
	if not player then return false end
	local api = getAdminAPI()
	if api then
		local ok, level = pcall(function()
			return api:Invoke(player)
		end)
		if ok and level and level >= MIN_ADMIN_LEVEL then
			return true
		end
	end
	return false
end

print("[CarSpawner] Waiting for Adonis Plugin...")
if getAdminAPI() then
	print("[CarSpawner] Adonis Plugin API ready")
else
	warn("[CarSpawner] Adonis Plugin not found - admin checks will fail")
end

local function getOwners(vehicle)
	local folder = vehicle:FindFirstChild("VehicleOwners")
	if not folder then return {} end
	local owners = {}
	for _, v in ipairs(folder:GetChildren()) do
		if v:IsA("StringValue") then table.insert(owners, v.Value) end
	end
	return owners
end

local function isVehicleOwner(player, vehicle)
	if not vehicle or not player then return false end
	local folder = vehicle:FindFirstChild("VehicleOwners")
	if not folder then return false end
	for _, v in ipairs(folder:GetChildren()) do
		if v:IsA("StringValue") and v.Value == player.Name then return true end
	end
	return false
end

local function addOwner(vehicle, playerName)
	if not vehicle then return false end
	local folder = vehicle:FindFirstChild("VehicleOwners") or Instance.new("Folder")
	folder.Name = "VehicleOwners"
	folder.Parent = vehicle
	for _, v in ipairs(folder:GetChildren()) do
		if v:IsA("StringValue") and v.Value == playerName then return false end
	end
	local owner = Instance.new("StringValue")
	owner.Name = "Owner_" .. playerName
	owner.Value = playerName
	owner.Parent = folder
	return true
end

local function canAccessVehicle(player, vehicle)
	if not vehicle or not player then return false end
	if isAdmin(player) or isVehicleOwner(player, vehicle) then return true end
	return vehicle:GetAttribute("IsLocked") ~= true
end

local function playLockSound(vehicle)
	if R and R.PlayLockSound then
		R.PlayLockSound:FireAllClients(vehicle)
	end
end

local function forceEjectPlayer(seat, player)
	if not seat or not player then return end
	local character = player.Character
	if not character then return end
	local humanoid, hrp = character:FindFirstChildOfClass("Humanoid"), character:FindFirstChild("HumanoidRootPart")
	for _, child in ipairs(seat:GetChildren()) do
		if child:IsA("Weld") and child.Name == "SeatWeld" then child:Destroy() end
	end
	if humanoid then humanoid.Sit, humanoid.Jump = false, true; humanoid:ChangeState(Enum.HumanoidStateType.Freefall) end
	if hrp then
		for _, child in ipairs(hrp:GetChildren()) do
			if (child:IsA("Weld") or child:IsA("Motor6D")) and (child.Part0 == seat or child.Part1 == seat) then child:Destroy() end
		end
		hrp.CFrame = hrp.CFrame + Vector3.new(0, 5, 0)
		hrp.AssemblyLinearVelocity = Vector3.new(0, 20, 0)
	end
end

local function setupSeatMonitoring(vehicle)
	vehicle:SetAttribute("IsLocked", false)
	local vehicleId = tostring(vehicle:GetDebugId())
	vehicleConnections[vehicleId] = {}
	
	local function monitorSeat(seat)
		table.insert(vehicleConnections[vehicleId], seat:GetPropertyChangedSignal("Occupant"):Connect(function()
			local occupant = seat.Occupant
			if occupant then
				local char = occupant.Parent
				if char and char:IsA("Model") then
					local p = Players:GetPlayerFromCharacter(char)
					if p and vehicle:GetAttribute("IsLocked") and not canAccessVehicle(p, vehicle) then
						forceEjectPlayer(seat, p)
					end
				end
			end
		end))
		table.insert(vehicleConnections[vehicleId], seat.ChildAdded:Connect(function(child)
			if child:IsA("Weld") and child.Name == "SeatWeld" and child.Part1 then
				local char = child.Part1.Parent
				if char and char:IsA("Model") then
					local p = Players:GetPlayerFromCharacter(char)
					if p and vehicle:GetAttribute("IsLocked") and not canAccessVehicle(p, vehicle) then
						child:Destroy()
						forceEjectPlayer(seat, p)
					end
				end
			end
		end))
	end
	
	for _, desc in ipairs(vehicle:GetDescendants()) do
		if desc:IsA("VehicleSeat") or desc:IsA("Seat") then monitorSeat(desc) end
	end
	
	table.insert(vehicleConnections[vehicleId], vehicle:GetAttributeChangedSignal("IsLocked"):Connect(function()
		if vehicle:GetAttribute("IsLocked") then
			for _, desc in ipairs(vehicle:GetDescendants()) do
				if (desc:IsA("VehicleSeat") or desc:IsA("Seat")) and desc.Occupant then
					local char = desc.Occupant.Parent
					if char and char:IsA("Model") then
						local p = Players:GetPlayerFromCharacter(char)
						if p and not canAccessVehicle(p, vehicle) then forceEjectPlayer(desc, p) end
					end
				end
			end
		end
	end))
	
	table.insert(vehicleConnections[vehicleId], vehicle.DescendantAdded:Connect(function(desc)
		if desc:IsA("VehicleSeat") or desc:IsA("Seat") then monitorSeat(desc) end
	end))
	
	vehicle.Destroying:Connect(function()
		if vehicleConnections[vehicleId] then
			for _, conn in ipairs(vehicleConnections[vehicleId]) do conn:Disconnect() end
			vehicleConnections[vehicleId] = nil
		end
	end)
end

local function loadVehicle(assetId, isPreview)
	local ok, model = pcall(function() return InsertService:LoadAsset(assetId) end)
	if not ok or not model then return nil end
	local vehicleModel = model:FindFirstChildWhichIsA("Model", true)
	if not vehicleModel then model:Destroy(); return nil end
	local cloned = vehicleModel:Clone()
	model:Destroy()
	if isPreview then
		for _, desc in ipairs(cloned:GetDescendants()) do
			if desc:IsA("BasePart") then
				desc.Anchored, desc.CanCollide, desc.CanTouch, desc.CanQuery, desc.CollisionGroup = true, false, false, false, "VehiclePreviews"
				if desc.Transparency < 0.9 then desc.Transparency = 0.5 end
			elseif desc:IsA("VehicleSeat") or desc:IsA("Seat") then desc.Disabled = true
			elseif desc:IsA("Script") or desc:IsA("LocalScript") then desc.Disabled = true
			elseif desc:IsA("ProximityPrompt") then desc.Enabled = false
			elseif desc:IsA("ClickDetector") then desc:Destroy() end
		end
	end
	return cloned
end

local function positionVehicle(model, cframe, owner)
	local parts = {}
	for _, desc in ipairs(model:GetDescendants()) do
		if desc:IsA("BasePart") then
			table.insert(parts, {part = desc, wasAnchored = desc.Anchored})
			desc.Anchored = true
			desc.AssemblyLinearVelocity, desc.AssemblyAngularVelocity = Vector3.zero, Vector3.zero
			if owner then pcall(function() desc:SetNetworkOwner(owner) end) end
		end
	end
	model:PivotTo(cframe)
	task.wait(0.5)
	for _, data in ipairs(parts) do
		if data.part:IsDescendantOf(model) then
			data.part.AssemblyLinearVelocity, data.part.AssemblyAngularVelocity = Vector3.zero, Vector3.zero
			if not data.wasAnchored then data.part.Anchored = false end
		end
	end
end

local folder = ReplicatedStorage:FindFirstChild("CarSpawner") or Instance.new("Folder")
folder.Name, folder.Parent = "CarSpawner", ReplicatedStorage

local function makeRemote(name, class)
	local r = folder:FindFirstChild(name) or Instance.new(class)
	r.Name, r.Parent = name, folder
	return r
end

local R = {
	SpawnAtPos = makeRemote("SpawnCarAtPosition", "RemoteEvent"),
	GetCarList = makeRemote("GetCarList", "RemoteFunction"),
	CheckWhitelist = makeRemote("CheckWhitelist", "RemoteFunction"),
	CreatePreview = makeRemote("CreatePreview", "RemoteFunction"),
	UpdatePreview = makeRemote("UpdatePreview", "RemoteEvent"),
	DestroyPreview = makeRemote("DestroyPreview", "RemoteEvent"),
	DeleteVehicle = makeRemote("DeleteVehicle", "RemoteEvent"),
	AssignVehicle = makeRemote("AssignVehicle", "RemoteEvent"),
	GetPlayers = makeRemote("GetPlayers", "RemoteFunction"),
	ToggleLock = makeRemote("ToggleLock", "RemoteEvent"),
	GetLockState = makeRemote("GetLockState", "RemoteFunction"),
	NotifyAssignment = makeRemote("NotifyAssignment", "RemoteEvent"),
	GetVehicleAssignments = makeRemote("GetVehicleAssignments", "RemoteFunction"),
	PlayLockSound = makeRemote("PlayLockSound", "RemoteEvent"),
}

R.CheckWhitelist.OnServerInvoke = function(player) return isAdmin(player) end
R.GetCarList.OnServerInvoke = function(player) return isAdmin(player) and VEHICLES or {} end
R.GetPlayers.OnServerInvoke = function(player)
	if not isAdmin(player) then return {} end
	local list = {}
	for _, p in ipairs(Players:GetPlayers()) do table.insert(list, p.Name) end
	return list
end

R.CreatePreview.OnServerInvoke = function(player, carIndex)
	if not isAdmin(player) or not VEHICLES[carIndex] then return nil end
	if activePreviews[player.UserId] then activePreviews[player.UserId]:Destroy() end
	local preview = loadVehicle(VEHICLES[carIndex].assetId, true)
	if not preview then return nil end
	preview.Name, preview.Parent = "CarPreview_" .. player.Name, workspace
	local char = player.Character
	if char and char:FindFirstChild("HumanoidRootPart") then
		preview:PivotTo(char.HumanoidRootPart.CFrame * CFrame.new(0, 5, -15))
	end
	task.wait(0.1)
	activePreviews[player.UserId] = preview
	return preview
end

R.UpdatePreview.OnServerEvent:Connect(function(player, cframe)
	local preview = activePreviews[player.UserId]
	if preview and preview.Parent and typeof(cframe) == "CFrame" then preview:PivotTo(cframe) end
end)

R.DestroyPreview.OnServerEvent:Connect(function(player)
	if activePreviews[player.UserId] then
		activePreviews[player.UserId]:Destroy()
		activePreviews[player.UserId] = nil
	end
end)

R.SpawnAtPos.OnServerEvent:Connect(function(player, carIndex, cframe)
	if not isAdmin(player) or typeof(cframe) ~= "CFrame" or not VEHICLES[carIndex] then return end
	if activePreviews[player.UserId] then activePreviews[player.UserId]:Destroy(); activePreviews[player.UserId] = nil end
	local vehicle = loadVehicle(VEHICLES[carIndex].assetId, false)
	if not vehicle then return end
	local tag = Instance.new("StringValue")
	tag.Name, tag.Value, tag.Parent = "SpawnedVehicle", VEHICLES[carIndex].name, vehicle
	local ownersFolder = Instance.new("Folder")
	ownersFolder.Name = "VehicleOwners"
	ownersFolder.Parent = vehicle
	vehicle:SetAttribute("IsLocked", false)
	CollectionService:AddTag(vehicle, SPAWNED_TAG)
	vehicle.Parent = workspace
	positionVehicle(vehicle, cframe, nil)
	setupSeatMonitoring(vehicle)
end)

R.DeleteVehicle.OnServerEvent:Connect(function(player, vehicle)
	if not isAdmin(player) or not vehicle or not vehicle:IsA("Model") then return end
	if not CollectionService:HasTag(vehicle, SPAWNED_TAG) then return end
	vehicle:Destroy()
end)

R.AssignVehicle.OnServerEvent:Connect(function(player, vehicle, targetName)
	if not isAdmin(player) or not vehicle or not CollectionService:HasTag(vehicle, SPAWNED_TAG) then return end
	local targetPlayer = Players:FindFirstChild(targetName)
	if not targetPlayer or not addOwner(vehicle, targetPlayer.Name) then return end
	for _, part in ipairs(vehicle:GetDescendants()) do
		if part:IsA("BasePart") then pcall(function() part:SetNetworkOwner(targetPlayer) end) end
	end
	local vehicleName = vehicle:FindFirstChild("SpawnedVehicle") and vehicle.SpawnedVehicle.Value or "Vehicle"
	R.NotifyAssignment:FireClient(targetPlayer, vehicleName)
end)

R.ToggleLock.OnServerEvent:Connect(function(player, vehicle)
	if not vehicle or not vehicle:IsA("Model") or not CollectionService:HasTag(vehicle, SPAWNED_TAG) then return end
	if not (isVehicleOwner(player, vehicle) or isAdmin(player)) then return end
	vehicle:SetAttribute("IsLocked", not (vehicle:GetAttribute("IsLocked") or false))
	playLockSound(vehicle)
end)

R.GetLockState.OnServerInvoke = function(_, vehicle)
	return vehicle and vehicle:GetAttribute("IsLocked") == true
end

R.GetVehicleAssignments.OnServerInvoke = function(player)
	if not isAdmin(player) then return {} end
	local assignments = {}
	for _, vehicle in ipairs(CollectionService:GetTagged(SPAWNED_TAG)) do
		if vehicle and vehicle.Parent then
			table.insert(assignments, {
				vehicleName = vehicle:FindFirstChild("SpawnedVehicle") and vehicle.SpawnedVehicle.Value or "Unknown",
				owners = getOwners(vehicle),
				isLocked = vehicle:GetAttribute("IsLocked") or false,
				vehicleRef = vehicle
			})
		end
	end
	return assignments
end

Players.PlayerRemoving:Connect(function(player)
	if activePreviews[player.UserId] then
		activePreviews[player.UserId]:Destroy()
		activePreviews[player.UserId] = nil
	end
end)

print("[CarSpawner] Server loaded")
