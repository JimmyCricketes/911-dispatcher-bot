--[[
    GunGiver - Hybrid Version
    Combines hardcoded Studio whitelist + runtime Discord updates
    
    - Edit UserIDs table in Studio for permanent entries
    - Use Discord commands for live runtime additions
    - Runtime entries overlay/merge with hardcoded ones
]]

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local DATASTORE_NAME = "GunWhitelist"
local ENTRY_KEY = "whitelist_v1"
local REFRESH_INTERVAL = 60 -- Seconds between DataStore refreshes

--============================================================================--
--                     HARDCODED WHITELIST (Edit in Studio)                   --
--============================================================================--

local UserIDs = {
	[3274640368] = {"M1911", "M1928 TOMMY GUN"}, --chuhkee_moss
	[1465067028] = {".38 SNUBNOSE"}, --vud
	[56548114] = {".38 SNUBNOSE"}, --interstellarriptide
	[1834081320] = {"M1911", ".38 SNUBNOSE"}, --makai
	[24749217] = {".38 SNUBNOSE", "M1911"}, --OGSnipes20
	[810924509] = {".38 SNUBNOSE", "M1911"}, --dirtsocksguy
	[1131986134] = {".38 SNUBNOSE", "M1911", "M1897 Shotgun"}, --EngIishBloke
	[2583816107] = {"M1911"}, --mossmanV3
	[56444111] = {"M1911", "M1897 Shotgun", ".38 SNUBNOSE"}, --Triggered_Guy
	[317024926] = {"M1911"}, --Oldraelew
	[2617148664] = {"M1911", ".38 SNUBNOSE"}, --almightyzane
	[1780276456] = {".38 SNUBNOSE"}, --ffjosephii
	[417784525] = {".38 SNUBNOSE"}, --irwb
	[388744626] = {"M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN", "M1897 Shotgun"}, --Bigsquidz
	[469068528] = {"M1911", ".38 SNUBNOSE", "M1897 Shotgun"}, --lukas24422
	[1159919315] = {"M1911"}, --TheMeep_MeepGaming
	[8797665761] = {".38 SNUBNOSE"}, --NickyParisi
	[3433914248] = {".38 SNUBNOSE", "M1897 Shotgun"}, --elpepo_facha
	[8909620314] = {".38 SNUBNOSE", "M1911", "M1897 Shotgun"}, --BambukoRebel
	[1732659616] = {"M1911"}, --b0edser
	[3597328590] = {".38 SNUBNOSE"}, --Lettuce_Funky0
	[1424337553] = {"M1911", "M1928 TOMMY GUN", ".38 SNUBNOSE"}, --ibexe_king
	[1417614457] = {".38 SNUBNOSE"}, --L0RENZO121
	[1846610781] = {".38 SNUBNOSE", "M1911"}, --Kejiwafen
	[1464679925] = {".38 SNUBNOSE", "M1897 Shotgun"}, --ioanekingpro98
	[1830147413] = {"M1911", ".38 SNUBNOSE", "M1897 Shotgun"}, --Mr_Qbama
	[3170949659] = {"M1911", ".38 SNUBNOSE"}, --RonaldCMorrison
	[1351071106] = {".38 SNUBNOSE"}, --gen_wrigs124
	[1776017244] = {".38 SNUBNOSE"}, --proboxgamer2013
	[955487965] = {".38 SNUBNOSE"}, --firekiller326
	[814007398] = {".38 SNUBNOSE", "M1897 Shotgun"}, --galaxyboy_10000
	[2263443634] = {".38 SNUBNOSE"}, --Ninja12361961
	[986511712] = {".38 SNUBNOSE"}, --TheFalling_FireStar
	[445512125] = {".38 SNUBNOSE"}, --ThiefenX
	[1638404386] = {".38 SNUBNOSE"}, --Anarchbund
	[223857801] = {"M1911"}, --Skeletonik
	[544836564] = {".38 SNUBNOSE"}, --IDJLOVER_9231
	[27471332] = {".38 SNUBNOSE"}, --Ludakres
	[1696974243] = {".38 SNUBNOSE", "M1911"}, --coop_32123
	[3292035980] = {"M1911"}, --resoLsIorceN
	[1508649283] = {".38 SNUBNOSE", "M1897 Shotgun"}, --AllAboutToday2
	[1441492550] = {".38 SNUBNOSE"}, --S1NISTERREALITY
	[1844464778] = {"M1911"}, --IStoleYourBread12121
	[3587568832] = {".38 SNUBNOSE"}, --Bob_CoolPlay
	[4419542026] = {".38 SNUBNOSE"}, --VHSClassics
	[1637989816] = {"M1911"}, --UntilTheFlagStands
	[218499531] = {"M1911", "M1928 TOMMY GUN"}, --GGG12893
	[9519389212] = {"M1911"}, --RexkVaush
	[317824065] = {".38 SNUBNOSE"}, --fordshelby
	[113794875] = {"M1911", ".38 SNUBNOSE"}, --Hacksaw307
	[246411829] = {".38 SNUBNOSE"}, --redkillertank
	[3118272583] = {".38 SNUBNOSE"}, --yeahmateaye
	[15630577] = {".38 SNUBNOSE", "M1897 Shotgun", "M1928 TOMMY GUN"}, --connor030904
	[1361319250] = {"M1911"}, --Fawhausten
	[5813348341] = {".38 SNUBNOSE", "M1911"}, --XenoZuccx
	[424244958] = {"M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN", "M1897 Shotgun"}, --Tezreta
	[1756102589] = {".38 SNUBNOSE"}, --Farrell022
	[1851718638] = {"M1897 Shotgun"}, --OrangeBlossom
	[866995178] = {"M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN"}, --HarlowlGuess
	[85658932] = {"M1928 TOMMY GUN"}, --Sluger20067
	[105121893] = {"M1911"}, --Abyssal_deep
	[89366796] = {"M1928 TOMMY GUN"}, --IvorySturm
	[74456629] = {".38 SNUBNOSE"}, --stopplayingpretend
	[5146105380] = {".38 SNUBNOSE"}, --JibMan224
	[323942279] = {"M1911"}, --dreadedsabercut
	[159862881] = {"M1897 Shotgun", "M1911"}, --Nikkov_1
	[435924445] = {"M1911", "M1928 TOMMY GUN", "M1897 Shotgun"}, --ammsjer
	[5224923521] = {"M1911"}, --Wildcard_858
	[8336515931] = {".38 SNUBNOSE"}, --Brolyfan98
	[1951308725] = {"M1911"}, --koyslop
	[1976569166] = {".38 SNUBNOSE"}, --CubeTheHoly
}

--============================================================================--
--                           RUNTIME WHITELIST                                --
--============================================================================--

local runtimeWhitelist = {}
local whitelistStore = nil

local function loadRuntimeWhitelist()
	if not whitelistStore then
		local success, store = pcall(function()
			return DataStoreService:GetDataStore(DATASTORE_NAME)
		end)
		if success then
			whitelistStore = store
		else
			warn("[GunGiver] Failed to get DataStore:", store)
			return
		end
	end
	
	local success, data = pcall(function()
		return whitelistStore:GetAsync(ENTRY_KEY)
	end)
	
	if success and data then
		runtimeWhitelist = {}
		for idString, entry in pairs(data) do
			local idNumber = tonumber(idString)
			if idNumber and entry.guns then
				runtimeWhitelist[idNumber] = entry.guns
			end
		end
		print("[GunGiver] Loaded", #runtimeWhitelist, "runtime entries")
	end
end

-- Load runtime whitelist immediately on script start
loadRuntimeWhitelist()
print("[GunGiver] Initial runtime whitelist loaded:", next(runtimeWhitelist) and "entries found" or "empty")

-- Refresh runtime whitelist periodically
task.spawn(function()
	while true do
		task.wait(REFRESH_INTERVAL)
		loadRuntimeWhitelist()
	end
end)

--============================================================================--
--                         MERGED WHITELIST LOOKUP                            --
--============================================================================--

local function getPlayerGuns(userId: number): {string}?
	local guns = {}
	local seen = {}
	
	-- Add hardcoded guns
	if UserIDs[userId] then
		for _, gun in UserIDs[userId] do
			if not seen[gun] then
				table.insert(guns, gun)
				seen[gun] = true
			end
		end
	end
	
	-- Add runtime guns (overlay)
	if runtimeWhitelist[userId] then
		for _, gun in runtimeWhitelist[userId] do
			if not seen[gun] then
				table.insert(guns, gun)
				seen[gun] = true
			end
		end
	end
	
	return #guns > 0 and guns or nil
end

local function isWhitelisted(userId: number): boolean
	return UserIDs[userId] ~= nil or runtimeWhitelist[userId] ~= nil
end

--============================================================================--
--                              GUN GIVER                                     --
--============================================================================--

local function AddTools(Player: Player)
	local guns = getPlayerGuns(Player.UserId)
	if guns then
		for _, gun in guns do
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

Players.PlayerAdded:Connect(function(Player)
	local Tools = true

	-- Always connect CharacterAdded - check whitelist when spawning
	Player.CharacterAdded:Connect(function()
		task.wait(0.1)
		-- Check whitelist at spawn time (runtime may have updated)
		if isWhitelisted(Player.UserId) or Player:IsInGroup(16990403) then
			AddTools(Player)
		end
	end)

	-- Always connect Chatted for gun toggle
	Player.Chatted:Connect(function(message)
		if message == "guns" or message == "Guns" then
			-- Check whitelist when using command
			if not isWhitelisted(Player.UserId) and not Player:IsInGroup(16990403) then
				return
			end
			
			if Tools then
				Tools = false

				for _, tool in pairs(Player.Backpack:GetChildren()) do
					if tool:IsA("Tool") and game.ServerStorage:FindFirstChild(tool.Name) and tool:GetAttribute("phillyGun") then
						tool:Destroy()
					end
				end

				if Player.Character then
					for _, tool in pairs(Player.Character:GetChildren()) do
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
end)

print("[GunGiver] Hybrid system loaded - hardcoded + runtime whitelist")
