--[[
	CarSpawner Client Script
	Place in: StarterPlayerScripts
	
	Keybinds:
	- ] = Toggle menu
	- R = Rotate preview (15 degrees)
	- L = Lock/unlock nearby owned vehicle
	- Escape = Cancel placement
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")

local player = Players.LocalPlayer
local mouse = player:GetMouse()

local folder = ReplicatedStorage:WaitForChild("CarSpawner", 10)
if not folder then return end

local R = {
	CheckWhitelist = folder:WaitForChild("CheckWhitelist"),
	GetCarList = folder:WaitForChild("GetCarList"),
	SpawnAtPos = folder:WaitForChild("SpawnCarAtPosition"),
	CreatePreview = folder:WaitForChild("CreatePreview"),
	UpdatePreview = folder:WaitForChild("UpdatePreview"),
	DestroyPreview = folder:WaitForChild("DestroyPreview"),
	DeleteVehicle = folder:WaitForChild("DeleteVehicle"),
	AssignVehicle = folder:WaitForChild("AssignVehicle"),
	GetPlayers = folder:WaitForChild("GetPlayers"),
	ToggleLock = folder:WaitForChild("ToggleLock"),
	GetLockState = folder:WaitForChild("GetLockState"),
	NotifyAssignment = folder:WaitForChild("NotifyAssignment"),
	GetVehicleAssignments = folder:WaitForChild("GetVehicleAssignments"),
	PlayLockSound = folder:WaitForChild("PlayLockSound"),
}

local LOCK_SOUND_ID = "rbxassetid://92065430579470"

R.PlayLockSound.OnClientEvent:Connect(function(vehicle)
	if not vehicle or not vehicle.Parent then return end
	local part = vehicle:FindFirstChild("Body", true) or vehicle:FindFirstChildWhichIsA("BasePart", true) or vehicle.PrimaryPart
	if not part then return end
	local sound = Instance.new("Sound")
	sound.SoundId = LOCK_SOUND_ID
	sound.Volume = 1
	sound.RollOffMaxDistance = 60
	sound.RollOffMinDistance = 5
	sound.RollOffMode = Enum.RollOffMode.InverseTapered
	sound.Parent = part
	sound:Play()
	sound.Ended:Once(function()
		if sound and sound.Parent then sound:Destroy() end
	end)
end)

local isAdmin = R.CheckWhitelist:InvokeServer()
print("[CarSpawner] Admin:", isAdmin)

local COLORS = {
	bg = Color3.fromRGB(0, 0, 0),
	border = Color3.fromRGB(27, 42, 53),
	text = Color3.fromRGB(255, 255, 255),
	textDim = Color3.fromRGB(200, 200, 200),
	textFaint = Color3.fromRGB(150, 150, 150),
	red = Color3.fromRGB(176, 32, 0),
	dark = Color3.fromRGB(40, 40, 40),
	tabSelected = Color3.fromRGB(60, 60, 60),
	tabUnselected = Color3.fromRGB(40, 40, 40),
	button = Color3.fromRGB(50, 50, 50),
}

local state = {
	mode = "SPAWN",
	placementMode = false,
	currentPreview = nil,
	selectedCarIndex = nil,
	rotationAngle = 0,
	activeSpawnButton = nil,
	selectedVehicle = nil,
	selectionHighlight = nil,
	previewHeightOffset = 0,
	playerSelectionOpen = false,
	viewerHighlight = nil,
	highlightedVehicle = nil,
	hoverHighlight = nil,
	lastHoveredVehicle = nil,
	debounce = {},
}

local modeBtns = {}
local hoverConnection = nil
local playerSelectionGUI = nil
local assignmentsViewerGUI = nil
local mainGui = nil
local mainFrame = nil

local function Create(class, props)
	local inst = Instance.new(class)
	for k, v in pairs(props) do inst[k] = v end
	return inst
end

local function isPlayerOwner(vehicle, playerName)
	if not vehicle then return false end
	local ownersFolder = vehicle:FindFirstChild("VehicleOwners")
	if not ownersFolder then return false end
	for _, v in ipairs(ownersFolder:GetChildren()) do
		if v:IsA("StringValue") and v.Value == playerName then return true end
	end
	return false
end

local function findNearestOwnedVehicle()
	local char = player.Character
	if not char or not char:FindFirstChild("HumanoidRootPart") then return nil end
	local hrp = char.HumanoidRootPart
	local nearest, nearestDist = nil, 15
	for _, vehicle in ipairs(CollectionService:GetTagged("SpawnedVehicle")) do
		if isPlayerOwner(vehicle, player.Name) then
			local dist = (hrp.Position - vehicle:GetPivot().Position).Magnitude
			if dist < nearestDist then nearestDist, nearest = dist, vehicle end
		end
	end
	return nearest
end

local function showNotification(config)
	local existing = player.PlayerGui:FindFirstChild(config.name or "Notification")
	if existing then existing:Destroy() end
	local gui = Create("ScreenGui", {Name = config.name or "Notification", ResetOnSpawn = false, Parent = player.PlayerGui})
	local frame = Create("Frame", {
		Size = UDim2.new(0, config.width or 320, 0, config.height or 70),
		Position = UDim2.new(1, -(config.width or 320) - 20, 0, 20),
		BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.5,
		BorderSizePixel = 3, BorderColor3 = config.borderColor or COLORS.border, Parent = gui
	})
	local yPos = 5
	for _, item in ipairs(config.items) do
		Create("TextLabel", {
			Size = UDim2.new(1, -10, 0, item.height), Position = UDim2.new(0, 5, 0, yPos),
			BackgroundTransparency = 1, Text = item.text, TextColor3 = item.color or COLORS.text,
			Font = Enum.Font.RobotoCondensed, TextSize = item.size or 14,
			TextXAlignment = Enum.TextXAlignment.Center, TextWrapped = item.wrapped, Parent = frame
		})
		yPos = yPos + item.height
	end
	task.delay(config.duration or 3, function() if gui and gui.Parent then gui:Destroy() end end)
end

local function showError(msg)
	showNotification({name = "ErrorNotification", borderColor = COLORS.red, items = {
		{text = "Error", height = 25, color = Color3.fromRGB(255, 100, 100), size = 18},
		{text = msg, height = 35, color = COLORS.textDim, wrapped = true}
	}})
end

local function showLockNotification(locked, vehicleName)
	showNotification({name = "LockNotification", duration = 2, items = {
		{text = locked and "Car Locked" or "Car Unlocked", height = 25, size = 18},
		{text = vehicleName, height = 35, color = COLORS.textDim}
	}})
end

local function showAssignmentNotification(vehicleName)
	showNotification({name = "VehicleNotification", height = 100, duration = 5, items = {
		{text = "Vehicle Assigned", height = 30, size = 18},
		{text = vehicleName, height = 25, color = COLORS.textDim, size = 16},
		{text = "Press L near vehicle to lock/unlock", height = 25, color = COLORS.textFaint}
	}})
end

local function closePlayerSelection()
	if playerSelectionGUI then playerSelectionGUI.Enabled = false end
	if state.selectionHighlight then state.selectionHighlight:Destroy(); state.selectionHighlight = nil end
	state.selectedVehicle = nil
	state.playerSelectionOpen = false
end

local function cancelPlacement()
	if state.placementMode then
		R.DestroyPreview:FireServer()
		state.currentPreview, state.placementMode, state.selectedCarIndex, state.rotationAngle, state.previewHeightOffset = nil, false, nil, 0, 0
		if state.activeSpawnButton then
			state.activeSpawnButton.Text = "SPAWN"
			state.activeSpawnButton.BackgroundColor3 = COLORS.dark
			state.activeSpawnButton = nil
		end
	end
end

local function calculateHeightOffset(model)
	if not model then return 0 end
	local minY = math.huge
	for _, part in ipairs(model:GetDescendants()) do
		if part:IsA("BasePart") then
			local bottomY = part.Position.Y - (part.Size.Y / 2)
			if bottomY < minY then minY = bottomY end
		end
	end
	return minY == math.huge and 0 or (model:GetPivot().Position.Y - minY)
end

local function updateModeButtons()
	for mode, btn in pairs(modeBtns) do
		if mode == "VIEW" then
			btn.BackgroundColor3, btn.BackgroundTransparency = COLORS.tabUnselected, 0.3
		elseif state.mode == mode then
			btn.BackgroundColor3, btn.BackgroundTransparency = COLORS.tabSelected, 0
		else
			btn.BackgroundColor3, btn.BackgroundTransparency = COLORS.tabUnselected, 0.3
		end
	end
end

local function updateModeHover()
	if state.mode ~= "DELETE" and state.mode ~= "ASSIGN" then
		if state.hoverHighlight then state.hoverHighlight:Destroy(); state.hoverHighlight = nil; state.lastHoveredVehicle = nil end
		return
	end
	local target = mouse.Target
	if not target then
		if state.hoverHighlight then state.hoverHighlight:Destroy(); state.hoverHighlight = nil; state.lastHoveredVehicle = nil end
		return
	end
	local model, attempts = target, 0
	while model and attempts < 20 do
		if model:IsA("Model") and model:FindFirstChild("SpawnedVehicle") then
			if state.lastHoveredVehicle ~= model then
				if state.hoverHighlight then state.hoverHighlight:Destroy() end
				state.hoverHighlight = Create("Highlight", {
					Adornee = model,
					FillColor = state.mode == "DELETE" and Color3.fromRGB(255, 50, 50) or Color3.fromRGB(50, 150, 255),
					OutlineColor = state.mode == "DELETE" and Color3.fromRGB(255, 0, 0) or Color3.fromRGB(0, 100, 255),
					FillTransparency = 0.3, OutlineTransparency = 0,
					DepthMode = Enum.HighlightDepthMode.AlwaysOnTop, Parent = model
				})
				state.lastHoveredVehicle = model
			end
			return
		end
		model = model.Parent
		attempts = attempts + 1
	end
	if state.hoverHighlight then state.hoverHighlight:Destroy(); state.hoverHighlight = nil; state.lastHoveredVehicle = nil end
end

local function toggleHighlightVehicle(vehicle)
	if not vehicle or not vehicle.Parent then return end
	if state.highlightedVehicle == vehicle and state.viewerHighlight then
		state.viewerHighlight:Destroy(); state.viewerHighlight = nil; state.highlightedVehicle = nil
		return
	end
	if state.viewerHighlight then state.viewerHighlight:Destroy() end
	state.viewerHighlight = Create("Highlight", {
		Adornee = vehicle, FillColor = COLORS.text, FillTransparency = 0.5,
		OutlineColor = COLORS.text, OutlineTransparency = 0,
		DepthMode = Enum.HighlightDepthMode.AlwaysOnTop, Parent = vehicle
	})
	state.highlightedVehicle = vehicle
end

local function createHighlight(model)
	if state.selectionHighlight then state.selectionHighlight:Destroy() end
	state.selectionHighlight = Create("Highlight", {
		Adornee = model, FillColor = Color3.fromRGB(200, 200, 200), FillTransparency = 0.2,
		OutlineColor = COLORS.text, OutlineTransparency = 0,
		DepthMode = Enum.HighlightDepthMode.AlwaysOnTop, Parent = model
	})
end

local function populateAssignmentsViewer(scroll, assignments)
	for _, child in ipairs(scroll:GetChildren()) do
		if not child:IsA("UIListLayout") then child:Destroy() end
	end
	if #assignments == 0 then
		Create("TextLabel", {Size = UDim2.new(1, -10, 0, 30), BackgroundTransparency = 1, Text = "No vehicles spawned", TextColor3 = COLORS.textFaint, Font = Enum.Font.RobotoCondensed, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Center, Parent = scroll})
		return
	end
	local counts, counters = {}, {}
	for _, a in ipairs(assignments) do counts[a.vehicleName] = (counts[a.vehicleName] or 0) + 1 end
	for _, a in ipairs(assignments) do
		counters[a.vehicleName] = (counters[a.vehicleName] or 0) + 1
		local displayName = counts[a.vehicleName] > 1 and (a.vehicleName .. " #" .. counters[a.vehicleName]) or a.vehicleName
		local btn = Create("TextButton", {Size = UDim2.new(1, -10, 0, 0), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.5, BorderSizePixel = 2, BorderColor3 = COLORS.border, AutomaticSize = Enum.AutomaticSize.Y, AutoButtonColor = false, Text = "", Parent = scroll})
		btn.MouseButton1Click:Connect(function() toggleHighlightVehicle(a.vehicleRef) end)
		btn.MouseEnter:Connect(function() btn.BackgroundTransparency = 0.3 end)
		btn.MouseLeave:Connect(function() btn.BackgroundTransparency = 0.5 end)
		Create("UIListLayout", {Padding = UDim.new(0, 2), Parent = btn})
		Create("UIPadding", {PaddingTop = UDim.new(0, 5), PaddingBottom = UDim.new(0, 5), PaddingLeft = UDim.new(0, 5), PaddingRight = UDim.new(0, 5), Parent = btn})
		Create("TextLabel", {Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = displayName, TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 16, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 1, Parent = btn})
		Create("TextLabel", {Size = UDim2.new(1, 0, 0, 18), BackgroundTransparency = 1, Text = #a.owners == 0 and "Owners: Unassigned" or "Owners: " .. table.concat(a.owners, ", "), TextColor3 = #a.owners == 0 and COLORS.textFaint or COLORS.textDim, Font = Enum.Font.RobotoCondensed, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Left, TextWrapped = true, AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 2, Parent = btn})
	end
end

local function showAssignmentsViewer()
	if assignmentsViewerGUI and assignmentsViewerGUI.Parent then
		local frame = assignmentsViewerGUI:FindFirstChild("MainFrame")
		if frame then
			local scroll = frame:FindFirstChild("ScrollFrame")
			if scroll then populateAssignmentsViewer(scroll, R.GetVehicleAssignments:InvokeServer()); return end
		end
		assignmentsViewerGUI:Destroy(); assignmentsViewerGUI = nil
	end
	local assignments = R.GetVehicleAssignments:InvokeServer()
	assignmentsViewerGUI = Create("ScreenGui", {Name = "AssignmentsViewer", ResetOnSpawn = false, Parent = player.PlayerGui})
	local frame = Create("Frame", {Name = "MainFrame", Size = UDim2.new(0, 400, 0, 500), Position = UDim2.new(0.5, -200, 0.5, -250), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.3, BorderSizePixel = 3, BorderColor3 = COLORS.border, Parent = assignmentsViewerGUI})
	local titleBar = Create("Frame", {Size = UDim2.new(1, 0, 0, 35), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.5, BorderSizePixel = 0, Parent = frame})
	Create("TextLabel", {Size = UDim2.new(1, -40, 1, 0), BackgroundTransparency = 1, Text = "Vehicle Assignments", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 18, TextXAlignment = Enum.TextXAlignment.Center, Parent = titleBar})
	local closeBtn = Create("TextButton", {Size = UDim2.new(0, 30, 0, 30), Position = UDim2.new(1, -33, 0, 2.5), BackgroundColor3 = COLORS.red, BorderSizePixel = 2, BorderColor3 = COLORS.border, Text = "X", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 14, Parent = titleBar})
	closeBtn.MouseButton1Click:Connect(function() assignmentsViewerGUI:Destroy(); assignmentsViewerGUI = nil end)
	local scroll = Create("ScrollingFrame", {Name = "ScrollFrame", Size = UDim2.new(1, -10, 1, -45), Position = UDim2.new(0, 5, 0, 40), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 6, ScrollBarImageColor3 = Color3.fromRGB(100, 100, 100), ScrollBarImageTransparency = 0.4, AutomaticCanvasSize = Enum.AutomaticSize.Y, Parent = frame})
	Create("UIListLayout", {Padding = UDim.new(0, 5), Parent = scroll})
	populateAssignmentsViewer(scroll, assignments)
end

local function showPlayerSelection()
	if playerSelectionGUI and playerSelectionGUI.Parent then
		playerSelectionGUI.Enabled = not playerSelectionGUI.Enabled
		state.playerSelectionOpen = playerSelectionGUI.Enabled
		if not playerSelectionGUI.Enabled then closePlayerSelection() end
		return
	end
	state.playerSelectionOpen = true
	local playersList = R.GetPlayers:InvokeServer()
	if not playersList or #playersList == 0 then state.playerSelectionOpen = false; return end
	playerSelectionGUI = Create("ScreenGui", {Name = "PlayerSelectionGui", ResetOnSpawn = false, Parent = player.PlayerGui})
	local frame = Create("Frame", {Size = UDim2.new(0, 250, 0, 350), Position = UDim2.new(0.5, -125, 0.5, -175), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.3, BorderSizePixel = 3, BorderColor3 = COLORS.border, Parent = playerSelectionGUI})
	Create("TextLabel", {Size = UDim2.new(1, 0, 0, 30), BackgroundTransparency = 1, Text = "Select Player", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 18, TextXAlignment = Enum.TextXAlignment.Center, Parent = frame})
	local searchContainer = Create("Frame", {Size = UDim2.new(1, -20, 0, 35), Position = UDim2.new(0, 10, 0, 35), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.5, BorderSizePixel = 2, BorderColor3 = COLORS.border, Parent = frame})
	local searchBox = Create("TextBox", {Size = UDim2.new(1, -10, 1, -4), Position = UDim2.new(0, 5, 0, 2), BackgroundTransparency = 1, Text = "", PlaceholderText = "Search players...", TextColor3 = COLORS.text, PlaceholderColor3 = COLORS.textFaint, Font = Enum.Font.RobotoCondensed, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Left, ClearTextOnFocus = false, Parent = searchContainer})
	local scroll = Create("ScrollingFrame", {Size = UDim2.new(1, -10, 1, -85), Position = UDim2.new(0, 5, 0, 75), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 6, ScrollBarImageColor3 = Color3.fromRGB(100, 100, 100), ScrollBarImageTransparency = 0.4, AutomaticCanvasSize = Enum.AutomaticSize.Y, Parent = frame})
	Create("UIListLayout", {Padding = UDim.new(0, 3), Parent = scroll})
	local playerButtons = {}
	for _, name in ipairs(playersList) do
		local btn = Create("TextButton", {Size = UDim2.new(1, -10, 0, 30), BackgroundColor3 = COLORS.dark, BorderSizePixel = 2, BorderColor3 = COLORS.border, Text = name, TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 14, Parent = scroll})
		btn.MouseEnter:Connect(function() btn.BackgroundColor3 = COLORS.button end)
		btn.MouseLeave:Connect(function() btn.BackgroundColor3 = COLORS.dark end)
		btn.MouseButton1Click:Connect(function()
			if state.debounce[btn] then return end
			if state.selectedVehicle then
				if isPlayerOwner(state.selectedVehicle, name) then showError("Already assigned"); return end
				state.debounce[btn] = true
				btn.Text = "..."
				R.AssignVehicle:FireServer(state.selectedVehicle, name)
				task.wait(0.3)
				state.debounce[btn] = nil
				btn.Text = name
			end
			closePlayerSelection()
		end)
		table.insert(playerButtons, {button = btn, name = name})
	end
	searchBox:GetPropertyChangedSignal("Text"):Connect(function()
		local searchText = searchBox.Text:lower()
		for _, data in ipairs(playerButtons) do
			data.button.Visible = searchText == "" or data.name:lower():find(searchText, 1, true) ~= nil
		end
	end)
	task.wait(0.1); searchBox:CaptureFocus()
	playerSelectionGUI.Destroying:Connect(function() state.playerSelectionOpen = false; playerSelectionGUI = nil end)
end

local function getBaseVehicleName(fullName)
	local variantWords = {"Red", "Blue", "Brown", "Green", "Yellow", "Black", "White", "Gray", "Grey", "Cab", "Variant", "Baby", "Light", "Dark", "V1", "V2", "V3"}
	local words = {}
	for word in fullName:gmatch("%S+") do table.insert(words, word) end
	while #words > 1 do
		local lastWord = words[#words]
		local isVariant = false
		for _, v in ipairs(variantWords) do if lastWord == v then isVariant = true; break end end
		if lastWord:match("^%d+$") or lastWord:match("^V%d+$") then isVariant = true end
		if isVariant then table.remove(words, #words) else break end
	end
	return table.concat(words, " ")
end

R.NotifyAssignment.OnClientEvent:Connect(showAssignmentNotification)

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	if input.KeyCode == Enum.KeyCode.L then
		local vehicle = findNearestOwnedVehicle()
		if vehicle then
			R.ToggleLock:FireServer(vehicle)
			task.wait(0.2)
			local locked = R.GetLockState:InvokeServer(vehicle)
			local name = vehicle:FindFirstChild("SpawnedVehicle") and vehicle.SpawnedVehicle.Value or "Vehicle"
			showLockNotification(locked, name)
		end
	end
	if not isAdmin then return end
	if input.KeyCode == Enum.KeyCode.Escape then
		closePlayerSelection()
		cancelPlacement()
	elseif input.KeyCode == Enum.KeyCode.R and state.placementMode then
		state.rotationAngle = (state.rotationAngle + 15) % 360
	elseif input.KeyCode == Enum.KeyCode.RightBracket then
		if mainFrame then
			mainFrame.Visible = not mainFrame.Visible
			if mainFrame.Visible and not hoverConnection then
				hoverConnection = RunService.Heartbeat:Connect(updateModeHover)
			elseif not mainFrame.Visible and hoverConnection then
				hoverConnection:Disconnect(); hoverConnection = nil
			end
		end
	end
end)

if isAdmin then
	local carList = R.GetCarList:InvokeServer()
	if not carList or #carList == 0 then return end
	
	mainGui = Create("ScreenGui", {Name = "CarSpawnerGui", ResetOnSpawn = false, Parent = player.PlayerGui})
	mainFrame = Create("Frame", {Name = "MainFrame", Size = UDim2.new(0, 320, 0, 550), Position = UDim2.new(1, -340, 0.5, -275), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.5, BorderSizePixel = 3, BorderColor3 = COLORS.border, Visible = false, Parent = mainGui})
	
	local titleBar = Create("Frame", {Size = UDim2.new(1, 0, 0, 40), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.5, BorderSizePixel = 0, Parent = mainFrame})
	Create("TextLabel", {Size = UDim2.new(1, -50, 1, 0), BackgroundTransparency = 1, Text = "Vehicle Spawner", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 18, TextXAlignment = Enum.TextXAlignment.Center, Parent = titleBar})
	local closeBtn = Create("TextButton", {Size = UDim2.new(0, 35, 0, 35), Position = UDim2.new(1, -38, 0, 2.5), BackgroundColor3 = COLORS.red, BorderSizePixel = 3, BorderColor3 = COLORS.border, Text = "X", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 16, Parent = titleBar})
	closeBtn.MouseButton1Click:Connect(function()
		mainFrame.Visible = false
		closePlayerSelection()
		if hoverConnection then hoverConnection:Disconnect(); hoverConnection = nil end
		cancelPlacement()
		state.mode = "SPAWN"
	end)
	
	local modeFrame = Create("Frame", {Size = UDim2.new(1, -20, 0, 35), Position = UDim2.new(0, 10, 0, 45), BackgroundTransparency = 1, Parent = mainFrame})
	local function createModeBtn(text, pos)
		return Create("TextButton", {Size = UDim2.new(0.24, -3, 1, 0), Position = pos, BackgroundColor3 = COLORS.tabUnselected, BackgroundTransparency = 0.3, BorderSizePixel = 3, BorderColor3 = COLORS.border, Text = text, TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 13, Parent = modeFrame})
	end
	modeBtns = {
		SPAWN = createModeBtn("SPAWN", UDim2.new(0, 0, 0, 0)),
		DELETE = createModeBtn("DELETE", UDim2.new(0.26, 0, 0, 0)),
		ASSIGN = createModeBtn("ASSIGN", UDim2.new(0.52, 0, 0, 0)),
		VIEW = createModeBtn("VIEW", UDim2.new(0.78, 0, 0, 0)),
	}
	modeBtns.SPAWN.MouseButton1Click:Connect(function() state.mode = "SPAWN"; updateModeButtons(); closePlayerSelection() end)
	modeBtns.DELETE.MouseButton1Click:Connect(function() state.mode = "DELETE"; updateModeButtons(); closePlayerSelection() end)
	modeBtns.ASSIGN.MouseButton1Click:Connect(function() state.mode = "ASSIGN"; updateModeButtons(); closePlayerSelection() end)
	modeBtns.VIEW.MouseButton1Click:Connect(showAssignmentsViewer)
	updateModeButtons()
	
	local scrollFrame = Create("ScrollingFrame", {Size = UDim2.new(1, -20, 1, -95), Position = UDim2.new(0, 10, 0, 85), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 8, ScrollBarImageColor3 = Color3.fromRGB(100, 100, 100), ScrollBarImageTransparency = 0.4, AutomaticCanvasSize = Enum.AutomaticSize.Y, Parent = mainFrame})
	Create("UIListLayout", {Padding = UDim.new(0, 5), Parent = scrollFrame})
	Create("UIPadding", {PaddingBottom = UDim.new(0, 20), PaddingLeft = UDim.new(0, 5), PaddingRight = UDim.new(0, 5), Parent = scrollFrame})
	
	local categorized = {}
	for i, car in ipairs(carList) do
		local cat = car.category or "Other"
		if not categorized[cat] then categorized[cat] = {} end
		if cat == "Police" or cat == "Fire Department" or cat == "Civil Defense" then
			categorized[cat][car.name .. "_" .. i] = {{name = car.name, index = i}}
		else
			local baseName = getBaseVehicleName(car.name)
			if not categorized[cat][baseName] then categorized[cat][baseName] = {} end
			table.insert(categorized[cat][baseName], {name = car.name, index = i})
		end
	end
	
	local function createSpawnButton(car, btn)
		return function()
			if state.debounce[btn] then return end
			if state.mode ~= "SPAWN" then state.mode = "SPAWN"; updateModeButtons(); closePlayerSelection(); return end
			if state.placementMode and state.activeSpawnButton == btn then
				cancelPlacement()
				return
			end
			if state.placementMode and state.activeSpawnButton then
				R.DestroyPreview:FireServer()
				state.activeSpawnButton.Text = "SPAWN"
				state.activeSpawnButton.BackgroundColor3 = COLORS.dark
			end
			state.debounce[btn], btn.Text = true, "..."
			local preview = R.CreatePreview:InvokeServer(car.index)
			state.debounce[btn] = nil
			if preview then
				state.currentPreview, state.selectedCarIndex, state.placementMode, state.rotationAngle, state.activeSpawnButton = preview, car.index, true, 0, btn
				task.wait(0.1)
				state.previewHeightOffset = calculateHeightOffset(preview)
				btn.Text, btn.BackgroundColor3 = "CANCEL", COLORS.red
			else
				btn.Text = "SPAWN"
			end
		end
	end
	
	local order = {"Police", "Fire Department", "Civil Defense", "Civilian", "Other"}
	local layoutOrder = 0
	for _, catName in ipairs(order) do
		local vehicleGroups = categorized[catName]
		if vehicleGroups then
			local header = Create("Frame", {Size = UDim2.new(1, -10, 0, 30), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.3, BorderSizePixel = 0, LayoutOrder = layoutOrder, Parent = scrollFrame})
			Create("TextLabel", {Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 1, Text = catName, TextColor3 = COLORS.textDim, Font = Enum.Font.RobotoCondensed, TextSize = 16, TextXAlignment = Enum.TextXAlignment.Center, Parent = header})
			layoutOrder = layoutOrder + 1
			for baseName, variants in pairs(vehicleGroups) do
				if #variants == 1 then
					local car = variants[1]
					local row = Create("Frame", {Size = UDim2.new(1, -10, 0, 40), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.5, BorderSizePixel = 3, BorderColor3 = COLORS.border, LayoutOrder = layoutOrder, Parent = scrollFrame})
					Create("TextLabel", {Size = UDim2.new(1, -70, 1, 0), Position = UDim2.new(0, 5, 0, 0), BackgroundTransparency = 1, Text = car.name, TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Parent = row})
					local btn = Create("TextButton", {Size = UDim2.new(0, 60, 1, -6), Position = UDim2.new(1, -63, 0, 3), BackgroundColor3 = COLORS.dark, BorderSizePixel = 3, BorderColor3 = COLORS.border, Text = "SPAWN", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 13, Parent = row})
					btn.MouseButton1Click:Connect(createSpawnButton(car, btn))
					layoutOrder = layoutOrder + 1
				else
					local groupContainer = Create("Frame", {Size = UDim2.new(1, -10, 0, 40), BackgroundTransparency = 1, ClipsDescendants = false, LayoutOrder = layoutOrder, Parent = scrollFrame})
					local displayName = baseName:gsub("_.*", "")
					local groupHeader = Create("TextButton", {Size = UDim2.new(1, 0, 0, 40), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.4, BorderSizePixel = 3, BorderColor3 = COLORS.border, Text = "", AutoButtonColor = false, Parent = groupContainer})
					local expandIndicator = Create("TextLabel", {Size = UDim2.new(0, 20, 1, 0), Position = UDim2.new(0, 5, 0, 0), BackgroundTransparency = 1, Text = "▶", TextColor3 = COLORS.textDim, Font = Enum.Font.RobotoCondensed, TextSize = 14, Parent = groupHeader})
					Create("TextLabel", {Size = UDim2.new(1, -30, 1, 0), Position = UDim2.new(0, 25, 0, 0), BackgroundTransparency = 1, Text = displayName .. " (" .. #variants .. ")", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 15, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Parent = groupHeader})
					local variantsContainer = Create("Frame", {Size = UDim2.new(1, 0, 0, 0), Position = UDim2.new(0, 0, 0, 43), BackgroundTransparency = 1, Visible = false, ClipsDescendants = false, Parent = groupContainer})
					Create("UIListLayout", {Padding = UDim.new(0, 3), Parent = variantsContainer})
					Create("UIPadding", {PaddingLeft = UDim.new(0, 20), Parent = variantsContainer})
					groupHeader.MouseButton1Click:Connect(function()
						variantsContainer.Visible = not variantsContainer.Visible
						expandIndicator.Text = variantsContainer.Visible and "▼" or "▶"
						if variantsContainer.Visible then
							local h = #variants * 38
							groupContainer.Size = UDim2.new(1, -10, 0, 40 + h + 6)
							variantsContainer.Size = UDim2.new(1, 0, 0, h)
						else
							groupContainer.Size = UDim2.new(1, -10, 0, 40)
							variantsContainer.Size = UDim2.new(1, 0, 0, 0)
						end
					end)
					for _, variant in ipairs(variants) do
						local row = Create("Frame", {Size = UDim2.new(1, 0, 0, 35), BackgroundColor3 = COLORS.bg, BackgroundTransparency = 0.6, BorderSizePixel = 2, BorderColor3 = COLORS.border, Parent = variantsContainer})
						local variantName = variant.name:gsub(displayName, ""):gsub("^%s+", "")
						if variantName == "" then variantName = "Default" end
						Create("TextLabel", {Size = UDim2.new(1, -70, 1, 0), Position = UDim2.new(0, 5, 0, 0), BackgroundTransparency = 1, Text = variantName, TextColor3 = COLORS.textDim, Font = Enum.Font.RobotoCondensed, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Parent = row})
						local btn = Create("TextButton", {Size = UDim2.new(0, 60, 1, -4), Position = UDim2.new(1, -62, 0, 2), BackgroundColor3 = COLORS.dark, BorderSizePixel = 2, BorderColor3 = COLORS.border, Text = "SPAWN", TextColor3 = COLORS.text, Font = Enum.Font.RobotoCondensed, TextSize = 12, Parent = row})
						btn.MouseButton1Click:Connect(createSpawnButton(variant, btn))
					end
					layoutOrder = layoutOrder + 1
				end
			end
		end
	end
	
	mouse.Button1Down:Connect(function()
		if state.placementMode and state.currentPreview and state.selectedCarIndex then
			local pos = mouse.Hit.Position + Vector3.new(0, state.previewHeightOffset, 0)
			local cf = CFrame.new(pos) * CFrame.Angles(0, math.rad(state.rotationAngle), 0)
			R.SpawnAtPos:FireServer(state.selectedCarIndex, cf)
			cancelPlacement()
		elseif state.mode == "DELETE" or state.mode == "ASSIGN" then
			local target = mouse.Target
			if target then
				local model = target
				for _ = 1, 20 do
					if model:IsA("Model") and model:FindFirstChild("SpawnedVehicle") then
						state.selectedVehicle = model
						createHighlight(model)
						if state.mode == "DELETE" then R.DeleteVehicle:FireServer(model); closePlayerSelection()
						elseif state.mode == "ASSIGN" then showPlayerSelection() end
						return
					end
					model = model.Parent
					if not model then break end
				end
			end
		end
	end)
	
	local lastUpdate = 0
	RunService.Heartbeat:Connect(function()
		if state.placementMode and state.currentPreview and state.currentPreview.Parent then
			local now = tick()
			if now - lastUpdate >= 0.03 then
				local pos = mouse.Hit.Position + Vector3.new(0, state.previewHeightOffset, 0)
				R.UpdatePreview:FireServer(CFrame.new(pos) * CFrame.Angles(0, math.rad(state.rotationAngle), 0))
				lastUpdate = now
			end
		end
	end)
end

print("[CarSpawner] Client loaded")
