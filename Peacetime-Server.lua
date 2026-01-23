--[[
	Peacetime Server Script
	Place in: ServerScriptService
]]

local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local peacetimeEnabled = true

-- Wait for Adonis Plugin API
local MIN_ADMIN_LEVEL = 100
local adminAPI = nil

local function getAdminAPI()
	if adminAPI then return adminAPI end
	local folder = RS:WaitForChild("AdonisAdminAPI", 30)
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

print("[Peacetime] Waiting for Adonis Plugin...")
if getAdminAPI() then
	print("[Peacetime] Adonis Plugin API ready")
else
	warn("[Peacetime] Adonis Plugin not found - admin checks will fail")
end

-- Setup remotes
local folder = RS:FindFirstChild("PeacetimeSystem") or Instance.new("Folder")
folder.Name = "PeacetimeSystem"
folder.Parent = RS

local function getRemote(name, className)
	local remote = folder:FindFirstChild(name) or Instance.new(className)
	remote.Name = name
	remote.Parent = folder
	return remote
end

local remotes = {
	checkWhitelist = getRemote("CheckWhitelist", "RemoteFunction"),
	togglePeacetime = getRemote("TogglePeacetime", "RemoteEvent"),
	peacetimeChanged = getRemote("PeacetimeChanged", "RemoteEvent"),
}

local function setPeacetime(enabled)
	peacetimeEnabled = enabled
	for _, player in ipairs(Players:GetPlayers()) do
		remotes.peacetimeChanged:FireClient(player, peacetimeEnabled)
	end
end

remotes.checkWhitelist.OnServerInvoke = function(player)
	return isAdmin(player)
end

remotes.togglePeacetime.OnServerEvent:Connect(function(player, action)
	if not isAdmin(player) then return end
	if action == "GET_STATE" then
		remotes.peacetimeChanged:FireClient(player, peacetimeEnabled)
	else
		setPeacetime(not peacetimeEnabled)
	end
end)

Players.PlayerAdded:Connect(function(player)
	task.wait(1)
	remotes.peacetimeChanged:FireClient(player, peacetimeEnabled)
end)

print("[Peacetime] Server loaded")
