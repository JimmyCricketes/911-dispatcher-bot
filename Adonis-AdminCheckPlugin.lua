--[[
	Adonis Plugin: Admin Check API
	
	INSTALL: Place this ModuleScript in ServerScriptService/Adonis_Loader/Config/Plugins
	Name it: Server-AdminCheckAPI
	
	This plugin runs AFTER Adonis initializes, guaranteeing access to the full API.
	Creates a RemoteFunction that any script can use to check admin level.
]]

return function(Vargs)
	local server = Vargs.Server
	local service = Vargs.Service
	
	-- Wait for services to be ready
	service.Events.CharacterAdded:Connect(function() end) -- Ensures events are loaded
	
	-- Create the admin check remote
	local RS = game:GetService("ReplicatedStorage")
	
	local folder = RS:FindFirstChild("AdonisAdminAPI")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "AdonisAdminAPI"
		folder.Parent = RS
	end
	
	local checkRemote = folder:FindFirstChild("CheckAdminLevel")
	if not checkRemote then
		checkRemote = Instance.new("RemoteFunction")
		checkRemote.Name = "CheckAdminLevel"
		checkRemote.Parent = folder
	end
	
	-- Handler: Returns the player's admin level
	checkRemote.OnServerInvoke = function(player)
		local level = server.Admin.GetLevel(player)
		return level or 0
	end
	
	-- Also create a server-side BindableFunction for other server scripts
	local bindable = folder:FindFirstChild("GetAdminLevel")
	if not bindable then
		bindable = Instance.new("BindableFunction")
		bindable.Name = "GetAdminLevel"
		bindable.Parent = folder
	end
	
	bindable.OnInvoke = function(player)
		if typeof(player) == "Instance" and player:IsA("Player") then
			return server.Admin.GetLevel(player)
		end
		return 0
	end
	
	print("[Adonis Plugin] AdminCheckAPI loaded - RemoteFunction and BindableFunction ready")
end
