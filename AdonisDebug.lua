-- DEBUG: Put in ServerScriptService, name it "AdonisDebug"
print("========== ADONIS DEBUG START ==========")

local SSS = game:GetService("ServerScriptService")

-- List all children of ServerScriptService
print("\n[1] ServerScriptService contents:")
for _, child in ipairs(SSS:GetChildren()) do
	print("  -", child.Name, "(" .. child.ClassName .. ")")
end

-- Check _G.Adonis (the runtime API)
print("\n[2] Checking _G.Adonis (runtime API):")
if _G.Adonis then
	print("  ✅ _G.Adonis exists")
	print("  CheckAdmin:", type(_G.Adonis.CheckAdmin))
	
	-- Test CheckAdmin on yourself
	local Players = game:GetService("Players")
	task.spawn(function()
		local testPlayer = Players:GetPlayers()[1]
		if testPlayer then
			local ok, level = pcall(_G.Adonis.CheckAdmin, testPlayer, false)
			print("  Test on", testPlayer.Name .. ":", ok and ("Level " .. tostring(level)) or ("Error: " .. tostring(level)))
		end
	end)
else
	print("  ❌ _G.Adonis is nil (not loaded yet or G_API disabled)")
end

-- Check shared.Adonis
print("\n[3] Checking shared.Adonis:")
print("  " .. (shared.Adonis and "✅ exists" or "❌ nil"))

-- Check Settings module (fallback)
print("\n[4] Checking Adonis Settings module:")
local settingsPaths = {
	"Adonis_Loader.Config.Settings",
	"Loader.Config.Settings",
}

for _, pathStr in ipairs(settingsPaths) do
	local parts = {}
	for part in pathStr:gmatch("[^.]+") do table.insert(parts, part) end
	
	local current = SSS
	local found = true
	for _, name in ipairs(parts) do
		local child = current:FindFirstChild(name)
		if child then current = child else found = false; break end
	end
	
	if found then
		print("  ✅ Found:", pathStr)
		local ok, settings = pcall(require, current)
		if ok and settings.Settings and settings.Settings.Ranks then
			print("  ✅ Settings.Ranks exists")
			for rankName, rankData in pairs(settings.Settings.Ranks) do
				local userCount = rankData.Users and #rankData.Users or 0
				print("    -", rankName, "(Level " .. (rankData.Level or "?") .. ", " .. userCount .. " users)")
			end
		else
			print("  ❌ Could not load Settings:", tostring(settings))
		end
	else
		print("  ❌ Not found:", pathStr)
	end
end

-- Wait and re-check _G.Adonis
print("\n[5] Waiting 5s for Adonis initialization...")
task.spawn(function()
	task.wait(5)
	print("\n[5b] Re-checking _G.Adonis after wait:")
	if _G.Adonis then
		print("  ✅ _G.Adonis now exists")
		print("  CheckAdmin:", type(_G.Adonis.CheckAdmin))
	else
		print("  ❌ Still nil - check if G_API = true in Adonis settings")
	end
	print("========== ADONIS DEBUG END ==========")
end)
