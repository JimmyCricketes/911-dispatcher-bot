--[[
    GunGiver (Rojo version)
    Requires UserIDs module that gets auto-synced from Discord
]]

local UserIDs = require(script.Parent.UserIDs)

local function AddTools(Player: Player)
	if UserIDs[Player.UserId] then
		for k, gun in UserIDs[Player.UserId] do
			if game.ServerStorage:FindFirstChild(gun) then
				local hasGun = Player.Backpack:FindFirstChild(gun) or (Player.Character and Player.Character:FindFirstChild(gun))
				if not hasGun then
					local newGun = game.ServerStorage:FindFirstChild(gun):Clone() :: Tool
					newGun.Parent = Player.Backpack
				end
			end
		end
	end

	if Player:IsInGroup(16990403) and not Player.Backpack:FindFirstChild(".38 SNUBNOSE") and not (Player.Character and Player.Character:FindFirstChild(".38 SNUBNOSE")) then
		local newGun = game.ServerStorage:FindFirstChild(".38 SNUBNOSE"):Clone() :: Tool
		newGun.Parent = Player.Backpack
	end
end

game.Players.PlayerAdded:Connect(function(Player)
	if UserIDs[Player.UserId] or Player:IsInGroup(16990403) then
		local Tools = true

		Player.CharacterAdded:Connect(function()
			task.wait(0.1)
			AddTools(Player)
		end)

		Player.Chatted:Connect(function(message)
			if message == "guns" or message == "Guns" then
				if Tools then
					Tools = false

					for k, tool in pairs(Player.Backpack:GetChildren()) do
						if tool:IsA("Tool") and game.ServerStorage:FindFirstChild(tool.Name) and tool:GetAttribute("phillyGun") then
							tool:Destroy()
						end
					end

					if Player.Character then
						for k, tool in pairs(Player.Character:GetChildren()) do
							if tool:IsA("Tool") and game.ServerStorage:FindFirstChild(tool.Name) and tool:GetAttribute("phillyGun") then
								tool:Destroy()
							end
						end
					end
				else
					Tools = true
					AddTools(Player)
				end
			end
		end)
	end
end)
