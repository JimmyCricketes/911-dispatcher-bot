--[[
	Freecam Client Script
	Place in: StarterPlayerScripts
	
	Controls:
	- K = Toggle freecam
	- WASD = Move
	- Q/E = Down/Up
	- Right Mouse = Look around
	- Up/Down Arrow = Adjust speed
	- Shift = Slow mode
	- ] = Toggle settings panel
]]

local pi, abs, clamp, exp, rad, sign, sqrt, tan = math.pi, math.abs, math.clamp, math.exp, math.rad, math.sign, math.sqrt, math.tan

local CAS = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")
local UIS = game:GetService("UserInputService")
local Lighting = game:GetService("Lighting")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local isMobile = UIS.TouchEnabled and not UIS.KeyboardEnabled

--// Configuration
local CFG = {
	MAX_DIST = 50,
	NAV_GAIN = Vector3.new(64, 64, 64),
	PAN_GAIN = Vector2.new(12, 16),
	ROLL_GAIN = 2,
	FOV_GAIN = 300,
	PITCH_LIM = rad(90),
	PRI = Enum.ContextActionPriority.High.Value,
}

--// Colors
local C = {
	bg = Color3.fromRGB(0, 0, 0),
	border = Color3.fromRGB(27, 42, 53),
	text = Color3.new(1, 1, 1),
	btn = Color3.fromRGB(42, 42, 42),
	red = Color3.fromRGB(176, 32, 0),
	accent = Color3.fromRGB(85, 170, 255),
	green = Color3.fromRGB(30, 100, 30),
}

--// State
local state = {
	peace = true,
	admin = false,
	active = false,
	keep = false,
	scroll = false,
	pos = Vector3.zero,
	rot = Vector2.zero,
	roll = 0,
	fov = 70,
	rmb = false,
	touch = false,
	lastTouch = nil,
	mobMove = Vector2.zero,
}

local fx = {}
local gui = {sliders = {}}
local set = {
	contrast = 0, brightness = 0, saturation = 0, temp = 0, exposure = 0,
	dof = false, dofDist = 10, dofSize = 24, vignette = 0, grain = 0, bloom = 0, grid = false,
}
local saved = {}
local conns = {}

local input = {
	gp = {X = 0, Y = 0, L1 = 0, R1 = 0, L2 = 0, R2 = 0, T1 = Vector2.zero, T2 = Vector2.zero},
	kb = {W = 0, A = 0, S = 0, D = 0, E = 0, Q = 0, Up = 0, Down = 0, LS = 0, RS = 0},
	m = {d = Vector2.zero, w = 0},
	spd = 1,
	conn = nil,
}

local presets = {}
local saveRemote, loadRemote = nil, nil
local peaceReady = false

--// Spring Class
local Spring = {}
Spring.__index = Spring

function Spring.new(freq, pos)
	return setmetatable({f = freq, p = pos, v = pos * 0}, Spring)
end

function Spring:Update(dt, goal)
	local w = self.f * 2 * pi
	local d = exp(-w * dt)
	local o = goal - self.p
	self.p = goal + (self.v * dt - o * (w * dt + 1)) * d
	self.v = (w * dt * (o * w - self.v) + self.v) * d
	return self.p
end

function Spring:Reset(pos)
	self.p = pos
	self.v = pos * 0
end

local spr = {
	vel = Spring.new(1.5, Vector3.zero),
	pan = Spring.new(1, Vector2.zero),
	roll = Spring.new(1, 0),
	fov = Spring.new(4, 0),
}

--// Helpers
local function Create(cls, props)
	local inst = Instance.new(cls)
	for k, v in pairs(props) do
		inst[k] = v
	end
	return inst
end

local function thumbCurve(x)
	local d = clamp((abs(x) - 0.15) / 0.85, 0, 1)
	return sign(x) * clamp((exp(2 * d) - 1) / (exp(2) - 1), 0, 1)
end

--// Peacetime Integration
task.spawn(function()
	local folder = RS:WaitForChild("PeacetimeSystem", 10)
	if not folder then
		state.peace = true
		peaceReady = true
		return
	end
	
	local check = folder:WaitForChild("CheckWhitelist", 5)
	if check then
		local ok, result = pcall(function()
			return check:InvokeServer()
		end)
		state.admin = ok and result or false
	end
	
	local changed = folder:WaitForChild("PeacetimeChanged", 5)
	if changed then
		changed.OnClientEvent:Connect(function(isPeacetime)
			state.peace = isPeacetime
			peaceReady = true
			if not isPeacetime and state.active and not state.admin then
				stopFreecam()
			end
		end)
		
		local toggle = folder:FindFirstChild("TogglePeacetime")
		if toggle then
			toggle:FireServer("GET_STATE")
		end
	end
	
	task.delay(3, function()
		if not peaceReady then
			state.peace = true
			peaceReady = true
		end
	end)
end)

--// Effects
local function initFx()
	if fx.cc then return end
	
	fx.cc = Create("ColorCorrectionEffect", {
		Parent = Lighting,
		Name = "FreecamCC",
		Enabled = true
	})
	
	fx.dof = Create("DepthOfFieldEffect", {
		Parent = Lighting,
		Name = "FreecamDOF",
		Enabled = false
	})
	
	fx.bloom = Create("BloomEffect", {
		Parent = Lighting,
		Name = "FreecamBloom",
		Enabled = false,
		Threshold = 0.8
	})
end

local function cleanFx()
	for k, v in pairs(fx) do
		if v then
			v:Destroy()
			fx[k] = nil
		end
	end
end

local function updateFx()
	if fx.cc then
		fx.cc.Contrast = set.contrast
		fx.cc.Brightness = set.brightness + set.exposure * 0.3
		fx.cc.Saturation = set.saturation
		
		local t = set.temp
		if t < 0 then
			fx.cc.TintColor = Color3.fromRGB(255 + t * 50, 255 + t * 30, 255)
		else
			fx.cc.TintColor = Color3.fromRGB(255, 255 - t * 50, 255 - t * 100)
		end
	end
	
	if fx.dof then
		fx.dof.Enabled = set.dof
		fx.dof.FocusDistance = set.dofDist
		fx.dof.InFocusRadius = set.dofSize
		fx.dof.FarIntensity = set.dof and 0.75 or 0
	end
	
	if fx.bloom then
		fx.bloom.Enabled = set.bloom > 0
		fx.bloom.Intensity = set.bloom * 0.5
		fx.bloom.Threshold = 0.8 - set.bloom * 0.2
	end
	
	if gui.vig then
		gui.vig.ImageTransparency = 1 - set.vignette / 10
	end
	
	if gui.grain then
		gui.grain.ImageTransparency = 1 - set.grain
	end
end

--// Input Processing
local function getVelocity(dt)
	input.spd = clamp(input.spd + dt * (input.kb.Up - input.kb.Down) * 0.75, 0.01, 4)
	
	local gp = Vector3.new(
		thumbCurve(input.gp.T1.x),
		thumbCurve(input.gp.R2) - thumbCurve(input.gp.L2),
		thumbCurve(-input.gp.T1.y)
	)
	
	local kb = Vector3.new(
		input.kb.D - input.kb.A,
		input.kb.E - input.kb.Q,
		input.kb.S - input.kb.W
	)
	
	local mob = Vector3.new(state.mobMove.X, 0, state.mobMove.Y)
	local slowMod = (input.kb.LS + input.kb.RS > 0) and 0.25 or 1
	
	return (gp + kb + mob) * input.spd * slowMod
end

local function getPan()
	if not state.rmb and not state.touch then
		input.m.d = Vector2.zero
		return Vector2.zero
	end
	
	local gp = Vector2.new(
		thumbCurve(input.gp.T2.y),
		thumbCurve(-input.gp.T2.x)
	) * (pi / 8)
	
	local m = input.m.d * (pi / 64)
	input.m.d = Vector2.zero
	
	return gp + m
end

local function startCapture()
	local keys = {
		Enum.KeyCode.W, Enum.KeyCode.A, Enum.KeyCode.S, Enum.KeyCode.D,
		Enum.KeyCode.E, Enum.KeyCode.Q, Enum.KeyCode.Up, Enum.KeyCode.Down,
		Enum.KeyCode.LeftShift, Enum.KeyCode.RightShift
	}
	
	local keyMap = {
		W = "W", A = "A", S = "S", D = "D", E = "E", Q = "Q",
		Up = "Up", Down = "Down", LeftShift = "LS", RightShift = "RS"
	}
	
	CAS:BindActionAtPriority("FCK", function(_, s, i)
		local key = keyMap[i.KeyCode.Name] or i.KeyCode.Name
		input.kb[key] = s == Enum.UserInputState.Begin and 1 or 0
		return Enum.ContextActionResult.Sink
	end, false, CFG.PRI, unpack(keys))
	
	CAS:BindActionAtPriority("FCW", function()
		return Enum.ContextActionResult.Sink
	end, false, CFG.PRI, Enum.UserInputType.MouseWheel)
	
	CAS:BindActionAtPriority("FCB", function(_, s, i)
		local name = i.KeyCode.Name
		local key = name:sub(-1) == "X" and "X" or name:sub(-1) == "Y" and "Y" or name:sub(-2)
		input.gp[key] = s == Enum.UserInputState.Begin and 1 or 0
		return Enum.ContextActionResult.Sink
	end, false, CFG.PRI, Enum.KeyCode.ButtonX, Enum.KeyCode.ButtonY, Enum.KeyCode.ButtonL1, Enum.KeyCode.ButtonR1)
	
	CAS:BindActionAtPriority("FCT", function(_, _, i)
		input.gp[i.KeyCode.Name:sub(-2)] = i.Position.z
		return Enum.ContextActionResult.Sink
	end, false, CFG.PRI, Enum.KeyCode.ButtonR2, Enum.KeyCode.ButtonL2)
	
	CAS:BindActionAtPriority("FCS", function(_, _, i)
		input.gp["T" .. i.KeyCode.Name:sub(-1)] = i.Position
		return Enum.ContextActionResult.Sink
	end, false, CFG.PRI, Enum.KeyCode.Thumbstick1, Enum.KeyCode.Thumbstick2)
	
	CAS:BindActionAtPriority("FCR", function(_, s)
		state.rmb = s == Enum.UserInputState.Begin
		UIS.MouseBehavior = state.rmb and Enum.MouseBehavior.LockCurrentPosition or Enum.MouseBehavior.Default
		return Enum.ContextActionResult.Sink
	end, false, CFG.PRI, Enum.UserInputType.MouseButton2)
	
	input.conn = UIS.InputChanged:Connect(function(i)
		if state.rmb and i.UserInputType == Enum.UserInputType.MouseMovement then
			input.m.d = Vector2.new(-i.Delta.Y, -i.Delta.X)
		end
	end)
end

local function stopCapture()
	input.spd = 1
	state.rmb = false
	state.touch = false
	state.lastTouch = nil
	state.mobMove = Vector2.zero
	UIS.MouseBehavior = Enum.MouseBehavior.Default
	
	for k in pairs(input.gp) do
		input.gp[k] = type(input.gp[k]) == "number" and 0 or Vector2.zero
	end
	for k in pairs(input.kb) do
		input.kb[k] = 0
	end
	input.m.d = Vector2.zero
	input.m.w = 0
	
	for _, action in ipairs({"FCK", "FCW", "FCB", "FCT", "FCS", "FCR"}) do
		pcall(CAS.UnbindAction, CAS, action)
	end
	
	if input.conn then
		input.conn:Disconnect()
		input.conn = nil
	end
	
	task.wait(0.05)
	UIS.MouseBehavior = Enum.MouseBehavior.Default
end

--// Mobile Support
local joyConn = nil
local touchConns = {}

local function startJoystick()
	if not isMobile then return end
	
	joyConn = RunService.RenderStepped:Connect(function()
		if not state.active then return end
		local char = player.Character
		local hum = char and char:FindFirstChildOfClass("Humanoid")
		if hum then
			local d = hum.MoveDirection
			state.mobMove = d.Magnitude > 0.01 and Vector2.new(d.X, -d.Z) or Vector2.zero
		end
	end)
end

local function stopJoystick()
	if joyConn then
		joyConn:Disconnect()
		joyConn = nil
	end
	state.mobMove = Vector2.zero
end

local function toggleMobileUI(hide)
	if not isMobile then return end
	local pg = player:FindFirstChildOfClass("PlayerGui")
	if not pg then return end
	
	local mobileGuis = {
		"MobileRagdollButton", "MobileRunButton", "MobileReloadButton",
		"MobileStanceButton", "MobileUseButton"
	}
	
	for _, name in ipairs(mobileGuis) do
		local g = pg:FindFirstChild(name)
		if g then
			g.Enabled = not hide
		end
	end
end

local function setupTouch()
	if not isMobile then return end
	
	for _, c in ipairs(touchConns) do
		c:Disconnect()
	end
	touchConns = {}
	
	local activePan = nil
	
	table.insert(touchConns, UIS.TouchStarted:Connect(function(t, gp)
		if gp or t.Position.X > camera.ViewportSize.X - 300 then return end
		
		if gui.main and gui.main.Visible then
			local m = gui.main
			local p = t.Position
			if p.X >= m.AbsolutePosition.X and p.X <= m.AbsolutePosition.X + m.AbsoluteSize.X and
			   p.Y >= m.AbsolutePosition.Y and p.Y <= m.AbsolutePosition.Y + m.AbsoluteSize.Y then
				return
			end
		end
		
		if not activePan and state.active then
			activePan = t
			state.touch = true
			state.lastTouch = t.Position
		end
	end))
	
	table.insert(touchConns, UIS.TouchMoved:Connect(function(t)
		if t == activePan and state.touch and state.lastTouch then
			local d = t.Position - state.lastTouch
			input.m.d = Vector2.new(-d.Y, -d.X)
			state.lastTouch = t.Position
		end
	end))
	
	table.insert(touchConns, UIS.TouchEnded:Connect(function(t)
		if t == activePan then
			activePan = nil
			state.touch = false
			state.lastTouch = nil
		end
	end))
end

--// State Management
local function saveState()
	saved.guis = {}
	local coreGuis = {"Backpack", "Chat", "Health", "PlayerList"}
	
	for _, name in ipairs(coreGuis) do
		pcall(function()
			saved.guis[name] = StarterGui:GetCoreGuiEnabled(Enum.CoreGuiType[name])
			StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType[name], false)
		end)
	end
	
	saved.screenGuis = {}
	local pg = player:FindFirstChildOfClass("PlayerGui")
	if pg then
		for _, g in ipairs(pg:GetChildren()) do
			if g:IsA("ScreenGui") and g.Enabled and
			   g.Name ~= "FreecamControls" and g.Name ~= "CarSpawnerGui" and
			   not g.Name:match("^Mobile") then
				table.insert(saved.screenGuis, {gui = g, enabled = g.Enabled})
				g.Enabled = false
			end
		end
	end
	
	saved.fov = camera.FieldOfView
	saved.cameraType = camera.CameraType
	saved.cframe = camera.CFrame
	saved.mouseIcon = UIS.MouseIconEnabled
	saved.mouseBehavior = UIS.MouseBehavior
	saved.maxZoom = player.CameraMaxZoomDistance
	saved.minZoom = player.CameraMinZoomDistance
	
	player.CameraMaxZoomDistance = 128
	player.CameraMinZoomDistance = 0.5
	camera.CameraType = Enum.CameraType.Custom
	UIS.MouseIconEnabled = true
	UIS.MouseBehavior = Enum.MouseBehavior.Default
	
	local char = player.Character
	if char then
		local hum = char:FindFirstChildOfClass("Humanoid")
		local hrp = char:FindFirstChild("HumanoidRootPart")
		
		if hum then
			saved.walkSpeed = hum.WalkSpeed
			saved.jumpHeight = hum.JumpHeight
			hum.WalkSpeed = 0
			hum.JumpHeight = 0
		end
		
		if hrp then
			saved.anchored = hrp.Anchored
			hrp.Anchored = true
		end
	end
end

local function restoreState()
	for name, enabled in pairs(saved.guis or {}) do
		pcall(function()
			StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType[name], enabled)
		end)
	end
	
	for _, data in ipairs(saved.screenGuis or {}) do
		if data.gui and data.gui.Parent then
			data.gui.Enabled = data.enabled
		end
	end
	
	if saved.fov then camera.FieldOfView = saved.fov end
	if saved.cameraType then camera.CameraType = saved.cameraType end
	if saved.cframe then camera.CFrame = saved.cframe end
	if saved.mouseIcon ~= nil then UIS.MouseIconEnabled = saved.mouseIcon end
	if saved.mouseBehavior then UIS.MouseBehavior = saved.mouseBehavior end
	if saved.maxZoom then player.CameraMaxZoomDistance = saved.maxZoom end
	if saved.minZoom then player.CameraMinZoomDistance = saved.minZoom end
	
	local char = player.Character
	if char then
		local hum = char:FindFirstChildOfClass("Humanoid")
		local hrp = char:FindFirstChild("HumanoidRootPart")
		
		if hum then
			if saved.walkSpeed then hum.WalkSpeed = saved.walkSpeed end
			if saved.jumpHeight then hum.JumpHeight = saved.jumpHeight end
		end
		
		if hrp and saved.anchored ~= nil then
			hrp.Anchored = saved.anchored
		end
	end
	
	saved = {}
end

--// Camera Step
local function clampPosition(pos)
	local hrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if not hrp then return pos end
	
	local dist = (pos - hrp.Position).Magnitude
	if dist > CFG.MAX_DIST then
		return hrp.Position + (pos - hrp.Position).Unit * CFG.MAX_DIST
	end
	return pos
end

local function cameraStep(dt)
	local vel = spr.vel:Update(dt, getVelocity(dt))
	local pan = spr.pan:Update(dt, getPan())
	local roll = spr.roll:Update(dt, (input.gp.R1 - input.gp.L1) * CFG.ROLL_GAIN)
	local fovDelta = spr.fov:Update(dt, 0)
	
	local z = sqrt(tan(rad(35)) / tan(rad(state.fov / 2)))
	state.fov = clamp(state.fov + fovDelta * CFG.FOV_GAIN * (dt / z), 1, 120)
	
	state.rot = state.rot + pan * CFG.PAN_GAIN * (dt / z)
	state.rot = Vector2.new(
		clamp(state.rot.x, -CFG.PITCH_LIM, CFG.PITCH_LIM),
		state.rot.y % (2 * pi)
	)
	state.roll = (state.roll + roll * dt) % (2 * pi)
	
	local cf = CFrame.fromOrientation(state.rot.x, state.rot.y, state.roll)
	local relVel = cf:VectorToWorldSpace(vel)
	state.pos = clampPosition((CFrame.new(state.pos) * CFrame.new(relVel * CFG.NAV_GAIN * dt)).Position)
	
	cf = CFrame.new(state.pos) * CFrame.fromOrientation(state.rot.x, state.rot.y, state.roll)
	camera.CFrame = cf
	camera.Focus = cf * CFrame.new(0, 0, -10)
	camera.FieldOfView = state.fov
end

--// Presets
local function savePresets()
	if not saveRemote then return false end
	local ok, result = pcall(function()
		return saveRemote:InvokeServer(presets)
	end)
	return ok and result == true
end

local function loadPresets()
	if not loadRemote then return end
	local ok, result = pcall(function()
		return loadRemote:InvokeServer()
	end)
	if ok and result then
		presets = result
	end
end

local function getCurrentSettings()
	return {
		contrast = set.contrast,
		brightness = set.brightness,
		saturation = set.saturation,
		temp = set.temp,
		exposure = set.exposure,
		dof = set.dof,
		dofDist = set.dofDist,
		dofSize = set.dofSize,
		vignette = set.vignette,
		grain = set.grain,
		bloom = set.bloom,
		grid = set.grid,
	}
end

local function applySettings(preset)
	for k, v in pairs(preset) do
		set[k] = v
	end
	
	for _, slider in ipairs(gui.sliders) do
		if preset[slider.key] ~= nil then
			local v = preset[slider.key]
			slider.fill.Size = UDim2.new((v - slider.min) / (slider.max - slider.min), 0, 1, 0)
			slider.lbl.Text = tostring(v)
		end
	end
	
	updateFx()
	
	if gui.grid then
		gui.grid.Visible = set.grid
	end
end

local function resetSettings()
	set.contrast = 0
	set.brightness = 0
	set.saturation = 0
	set.temp = 0
	set.exposure = 0
	set.vignette = 0
	set.grain = 0
	set.bloom = 0
	set.dof = false
	set.grid = false
	
	for _, slider in ipairs(gui.sliders) do
		slider.fill.Size = UDim2.new((slider.def - slider.min) / (slider.max - slider.min), 0, 1, 0)
		slider.lbl.Text = tostring(slider.def)
		slider.cb(slider.def)
	end
	
	if gui.grid then
		gui.grid.Visible = false
	end
	
	updateFx()
end

--// GUI Creation
local function createGUI()
	local pg = player:WaitForChild("PlayerGui")
	
	gui.sg = Create("ScreenGui", {
		Parent = pg,
		Name = "FreecamControls",
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		DisplayOrder = 100,
	})
	
	-- Grid overlay
	gui.grid = Create("Frame", {
		Parent = gui.sg,
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		Visible = false,
		ZIndex = 10,
	})
	
	for i = 1, 2 do
		Create("Frame", {
			Parent = gui.grid,
			Size = UDim2.new(0, 1, 1, 0),
			Position = UDim2.new(i / 3, 0, 0, 0),
			BackgroundColor3 = Color3.new(1, 1, 1),
			BackgroundTransparency = 0.7,
			BorderSizePixel = 0,
		})
		Create("Frame", {
			Parent = gui.grid,
			Size = UDim2.new(1, 0, 0, 1),
			Position = UDim2.new(0, 0, i / 3, 0),
			BackgroundColor3 = Color3.new(1, 1, 1),
			BackgroundTransparency = 0.7,
			BorderSizePixel = 0,
		})
	end
	
	-- Vignette
	gui.vig = Create("ImageLabel", {
		Parent = gui.sg,
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		Image = "rbxassetid://4576475453",
		ImageTransparency = 1,
		ZIndex = 5,
	})
	
	-- Grain
	gui.grain = Create("ImageLabel", {
		Parent = gui.sg,
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		Image = "rbxassetid://106149722952102",
		ImageTransparency = 1,
		ScaleType = Enum.ScaleType.Tile,
		TileSize = UDim2.new(0, 200, 0, 200),
		ZIndex = 6,
	})
	
	-- Main panel
	local panelHeight = isMobile and camera.ViewportSize.Y or 600
	gui.main = Create("Frame", {
		Parent = gui.sg,
		Size = UDim2.new(0, 280, 0, panelHeight),
		Position = isMobile and UDim2.new(1, -290, 0, 0) or UDim2.new(1, -300, 0.5, -panelHeight / 2),
		BackgroundColor3 = C.bg,
		BackgroundTransparency = 0.3,
		BorderSizePixel = 3,
		BorderColor3 = C.border,
		Visible = false,
		ZIndex = 1,
	})
	
	-- Title bar
	local titleBar = Create("Frame", {
		Parent = gui.main,
		Size = UDim2.new(1, 0, 0, 35),
		BackgroundColor3 = C.bg,
		BackgroundTransparency = 0.5,
		BorderSizePixel = 0,
		ZIndex = 2,
	})
	
	Create("TextLabel", {
		Parent = titleBar,
		Size = UDim2.new(1, -32, 1, 0),
		BackgroundTransparency = 1,
		Text = "Camera Settings",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 15,
		ZIndex = 3,
	})
	
	local closeBtn = Create("TextButton", {
		Parent = titleBar,
		Size = UDim2.new(0, 28, 0, 28),
		Position = UDim2.new(1, -32, 0, 3.5),
		BackgroundColor3 = C.red,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = "X",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 13,
		ZIndex = 3,
	})
	closeBtn.MouseButton1Click:Connect(function()
		gui.main.Visible = false
	end)
	
	-- Preset section
	local presetFrame = Create("Frame", {
		Parent = gui.main,
		Size = UDim2.new(1, -16, 0, 110),
		Position = UDim2.new(0, 8, 0, 40),
		BackgroundColor3 = C.bg,
		BackgroundTransparency = 0.7,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		ZIndex = 2,
	})
	
	Create("TextLabel", {
		Parent = presetFrame,
		Size = UDim2.new(1, -10, 0, 20),
		Position = UDim2.new(0, 5, 0, 5),
		BackgroundTransparency = 1,
		Text = "PRESETS",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 13,
		TextXAlignment = Enum.TextXAlignment.Left,
		ZIndex = 3,
	})
	
	local dropdown = Create("TextButton", {
		Parent = presetFrame,
		Size = UDim2.new(1, -10, 0, 30),
		Position = UDim2.new(0, 5, 0, 28),
		BackgroundColor3 = C.btn,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = #presets > 0 and presets[1].name or "No Presets",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 12,
		ZIndex = 3,
	})
	
	local presetIdx = 1
	local dropdownOpen = false
	local dropdownList = nil
	
	local function updateDropdown()
		dropdown.Text = #presets > 0 and presets[presetIdx] and presets[presetIdx].name or "No Presets"
	end
	
	-- Preset buttons
	local buttonContainer = Create("Frame", {
		Parent = presetFrame,
		Size = UDim2.new(1, -10, 0, 36),
		Position = UDim2.new(0, 5, 0, 64),
		BackgroundTransparency = 1,
		ZIndex = 2,
	})
	Create("UIListLayout", {
		Parent = buttonContainer,
		FillDirection = Enum.FillDirection.Horizontal,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		Padding = UDim.new(0, 3),
	})
	
	local delBtn = Create("TextButton", {
		Parent = buttonContainer,
		Size = UDim2.new(0.23, 0, 1, 0),
		BackgroundColor3 = C.btn,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = "DEL",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 10,
		ZIndex = 3,
	})
	
	local saveBtn = Create("TextButton", {
		Parent = buttonContainer,
		Size = UDim2.new(0.23, 0, 1, 0),
		BackgroundColor3 = C.btn,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = "SAVE",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 10,
		ZIndex = 3,
	})
	
	local renBtn = Create("TextButton", {
		Parent = buttonContainer,
		Size = UDim2.new(0.25, 0, 1, 0),
		BackgroundColor3 = C.btn,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = "REN",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 10,
		ZIndex = 3,
	})
	
	local loadBtn = Create("TextButton", {
		Parent = buttonContainer,
		Size = UDim2.new(0.23, 0, 1, 0),
		BackgroundColor3 = C.accent,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = "LOAD",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 10,
		ZIndex = 3,
	})
	
	dropdown.MouseButton1Click:Connect(function()
		if #presets == 0 then return end
		
		if dropdownOpen then
			if dropdownList then dropdownList:Destroy() end
			dropdownOpen = false
			return
		end
		
		dropdownOpen = true
		dropdownList = Create("Frame", {
			Parent = gui.sg,
			Size = UDim2.new(0, dropdown.AbsoluteSize.X, 0, math.min(#presets * 30, 200)),
			Position = UDim2.new(0, dropdown.AbsolutePosition.X, 0, dropdown.AbsolutePosition.Y + 32),
			BackgroundColor3 = C.bg,
			BackgroundTransparency = 0.2,
			BorderSizePixel = 2,
			BorderColor3 = C.border,
			ZIndex = 100,
		})
		
		local scroll = Create("ScrollingFrame", {
			Parent = dropdownList,
			Size = UDim2.new(1, 0, 1, 0),
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			ScrollBarThickness = 6,
			AutomaticCanvasSize = Enum.AutomaticSize.Y,
			ZIndex = 101,
		})
		Create("UIListLayout", {Parent = scroll, Padding = UDim.new(0, 2)})
		
		for i, p in ipairs(presets) do
			local opt = Create("TextButton", {
				Parent = scroll,
				Size = UDim2.new(1, -8, 0, 28),
				BackgroundColor3 = i == presetIdx and C.accent or C.btn,
				BackgroundTransparency = 0.3,
				BorderSizePixel = 1,
				BorderColor3 = C.border,
				Text = p.name,
				TextColor3 = C.text,
				Font = Enum.Font.RobotoCondensed,
				TextSize = 11,
				ZIndex = 102,
			})
			opt.MouseButton1Click:Connect(function()
				presetIdx = i
				updateDropdown()
				if dropdownList then dropdownList:Destroy() end
				dropdownOpen = false
			end)
		end
	end)
	
	saveBtn.MouseButton1Click:Connect(function()
		if #presets >= 10 then return end
		table.insert(presets, {
			name = "Preset " .. (#presets + 1),
			timestamp = os.time(),
			settings = getCurrentSettings(),
		})
		if savePresets() then
			presetIdx = #presets
			updateDropdown()
		else
			table.remove(presets)
		end
	end)
	
	loadBtn.MouseButton1Click:Connect(function()
		if #presets > 0 and presets[presetIdx] then
			applySettings(presets[presetIdx].settings)
		end
	end)
	
	delBtn.MouseButton1Click:Connect(function()
		if #presets == 0 or not presets[presetIdx] then return end
		local backup = table.remove(presets, presetIdx)
		if savePresets() then
			presetIdx = math.min(presetIdx, math.max(1, #presets))
			updateDropdown()
		else
			table.insert(presets, presetIdx, backup)
		end
	end)
	
	renBtn.MouseButton1Click:Connect(function()
		if #presets > 0 and presets[presetIdx] then
			presets[presetIdx].name = "Renamed" .. presetIdx
			savePresets()
			updateDropdown()
		end
	end)
	
	-- Keep effects toggle
	local keepFrame = Create("Frame", {
		Parent = gui.main,
		Size = UDim2.new(1, -16, 0, 36),
		Position = UDim2.new(0, 8, 0, 155),
		BackgroundColor3 = C.bg,
		BackgroundTransparency = 0.7,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		ZIndex = 2,
	})
	
	Create("TextLabel", {
		Parent = keepFrame,
		Size = UDim2.new(1, -60, 1, 0),
		Position = UDim2.new(0, 6, 0, 0),
		BackgroundTransparency = 1,
		Text = "Keep Effects",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 12,
		TextXAlignment = Enum.TextXAlignment.Left,
		ZIndex = 3,
	})
	
	local keepBtn = Create("TextButton", {
		Parent = keepFrame,
		Size = UDim2.new(0, 48, 0, 26),
		Position = UDim2.new(1, -52, 0.5, -13),
		BackgroundColor3 = C.btn,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = "OFF",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 11,
		ZIndex = 3,
	})
	
	keepBtn.MouseButton1Click:Connect(function()
		state.keep = not state.keep
		keepBtn.BackgroundColor3 = state.keep and C.green or C.btn
		keepBtn.Text = state.keep and "ON" or "OFF"
		if state.keep and not fx.cc then
			initFx()
			updateFx()
		end
	end)
	
	-- Reset button
	local resetBtn = Create("TextButton", {
		Parent = gui.main,
		Size = UDim2.new(1, -16, 0, 30),
		Position = UDim2.new(0, 8, 0, 196),
		BackgroundColor3 = C.accent,
		BorderSizePixel = 2,
		BorderColor3 = C.border,
		Text = "RESET ALL",
		TextColor3 = C.text,
		Font = Enum.Font.RobotoCondensed,
		TextSize = 13,
		ZIndex = 2,
	})
	resetBtn.MouseButton1Click:Connect(resetSettings)
	
	-- Scroll area for sliders
	local scroll = Create("ScrollingFrame", {
		Parent = gui.main,
		Size = UDim2.new(1, -8, 1, -233),
		Position = UDim2.new(0, 4, 0, 229),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		ScrollBarImageColor3 = C.border,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ZIndex = 2,
	})
	
	scroll:GetPropertyChangedSignal("CanvasPosition"):Connect(function()
		state.scroll = true
		task.delay(0.1, function()
			state.scroll = false
		end)
	end)
	
	Create("UIListLayout", {Parent = scroll, Padding = UDim.new(0, 4)})
	
	-- Slider definitions
	local sliderDefs = {
		{n = "Contrast", min = -1, max = 1, def = 0, key = "contrast"},
		{n = "Brightness", min = -1, max = 1, def = 0, key = "brightness"},
		{n = "Saturation", min = -1, max = 1, def = 0, key = "saturation"},
		{n = "Temperature", min = -1, max = 1, def = 0, key = "temp"},
		{n = "Exposure", min = -1, max = 1, def = 0, key = "exposure"},
		{n = "Focus Dist", min = 1, max = 100, def = 10, key = "dofDist", snap = 1},
		{n = "Blur Size", min = 1, max = 50, def = 24, key = "dofSize", snap = 1},
		{n = "Vignette", min = 0, max = 10, def = 0, key = "vignette", snap = 0.5},
		{n = "Grain", min = 0, max = 1, def = 0, key = "grain"},
		{n = "Bloom", min = 0, max = 1, def = 0, key = "bloom"},
	}
	
	for _, s in ipairs(sliderDefs) do
		local snap = s.snap or 0.05
		
		local cont = Create("Frame", {
			Parent = scroll,
			Size = UDim2.new(1, -10, 0, 50),
			BackgroundColor3 = C.bg,
			BackgroundTransparency = 0.7,
			BorderSizePixel = 2,
			BorderColor3 = C.border,
		})
		
		Create("TextLabel", {
			Parent = cont,
			Size = UDim2.new(1, -55, 0, 16),
			Position = UDim2.new(0, 5, 0, 3),
			BackgroundTransparency = 1,
			Text = s.n,
			TextColor3 = C.text,
			Font = Enum.Font.RobotoCondensed,
			TextSize = 13,
			TextXAlignment = Enum.TextXAlignment.Left,
		})
		
		local valLabel = Create("TextLabel", {
			Parent = cont,
			Size = UDim2.new(0, 45, 0, 16),
			Position = UDim2.new(1, -50, 0, 3),
			BackgroundTransparency = 1,
			Text = tostring(s.def),
			TextColor3 = C.accent,
			Font = Enum.Font.RobotoCondensed,
			TextSize = 12,
			TextXAlignment = Enum.TextXAlignment.Right,
		})
		
		local sliderBg = Create("Frame", {
			Parent = cont,
			Size = UDim2.new(1, -10, 0, 20),
			Position = UDim2.new(0, 5, 0, 24),
			BackgroundColor3 = C.btn,
			BorderSizePixel = 2,
			BorderColor3 = C.border,
		})
		
		local fill = Create("Frame", {
			Parent = sliderBg,
			Size = UDim2.new((s.def - s.min) / (s.max - s.min), 0, 1, 0),
			BackgroundColor3 = C.accent,
			BorderSizePixel = 0,
		})
		
		local sliderBtn = Create("TextButton", {
			Parent = sliderBg,
			Size = UDim2.new(1, 0, 1, 0),
			BackgroundTransparency = 1,
			Text = "",
		})
		
		local dragging = false
		local dragConns = {}
		
		sliderBtn.InputBegan:Connect(function(i)
			if (i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch) and not state.scroll then
				dragging = true
				
				table.insert(dragConns, UIS.InputEnded:Connect(function(e)
					if e.UserInputType == Enum.UserInputType.MouseButton1 or e.UserInputType == Enum.UserInputType.Touch then
						dragging = false
						for _, c in ipairs(dragConns) do c:Disconnect() end
						dragConns = {}
					end
				end))
				
				table.insert(dragConns, UIS.InputChanged:Connect(function(e)
					if dragging and (e.UserInputType == Enum.UserInputType.MouseMovement or e.UserInputType == Enum.UserInputType.Touch) and not state.scroll then
						local pos = isMobile and e.Position or UIS:GetMouseLocation()
						local rel = clamp((pos.X - sliderBg.AbsolutePosition.X) / sliderBg.AbsoluteSize.X, 0, 1)
						
						local v
						if s.max - s.min <= 2 then
							v = math.floor((s.min + (s.max - s.min) * rel - s.min) / snap + 0.5) * snap + s.min
						else
							v = math.floor(s.min + (s.max - s.min) * rel)
						end
						
						fill.Size = UDim2.new((v - s.min) / (s.max - s.min), 0, 1, 0)
						valLabel.Text = tostring(v)
						set[s.key] = v
						updateFx()
					end
				end))
			end
		end)
		
		table.insert(gui.sliders, {
			fill = fill,
			lbl = valLabel,
			min = s.min,
			max = s.max,
			def = s.def,
			key = s.key,
			cb = function(v)
				set[s.key] = v
				updateFx()
			end,
		})
	end
end

--// Main Functions
function startFreecam()
	if not peaceReady then return end
	if not state.peace and not state.admin then return end
	
	state.active = true
	state.rot = Vector2.new(camera.CFrame:ToEulerAnglesYXZ())
	state.pos = camera.CFrame.Position
	state.fov = camera.FieldOfView
	state.roll = 0
	
	spr.vel:Reset(Vector3.zero)
	spr.pan:Reset(Vector2.zero)
	spr.roll:Reset(0)
	spr.fov:Reset(0)
	
	if not fx.cc then initFx() end
	if gui.main then gui.main.Visible = true end
	
	if isMobile then
		setupTouch()
		startJoystick()
		toggleMobileUI(true)
	end
	
	saveState()
	RunService:BindToRenderStep("Freecam", Enum.RenderPriority.Camera.Value, cameraStep)
	startCapture()
	
	task.wait(0.1)
	updateFx()
end

function stopFreecam()
	UIS.MouseBehavior = Enum.MouseBehavior.Default
	state.rmb = false
	state.touch = false
	state.lastTouch = nil
	state.mobMove = Vector2.zero
	state.active = false
	
	stopCapture()
	RunService:UnbindFromRenderStep("Freecam")
	restoreState()
	
	if isMobile then
		toggleMobileUI(false)
		stopJoystick()
	end
	
	for _, c in ipairs(touchConns) do
		c:Disconnect()
	end
	touchConns = {}
	
	if not state.keep then
		cleanFx()
	end
	
	if gui.main then
		gui.main.Visible = false
	end
	
	task.wait(0.1)
	UIS.MouseBehavior = Enum.MouseBehavior.Default
end

--// Input Handling
UIS.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then return end
	
	if input.KeyCode == Enum.KeyCode.K then
		if state.active then
			stopFreecam()
		else
			startFreecam()
		end
	end
end)

-- Mobile toggle button
if isMobile then
	task.wait(0.5)
	local pg = player:WaitForChild("PlayerGui")
	local toggle = pg:WaitForChild("MobileFreecamToggle", 10)
	if toggle then
		toggle.Event:Connect(function()
			if state.active then
				stopFreecam()
			else
				startFreecam()
			end
		end)
	end
end

--// Initialization
task.spawn(function()
	saveRemote = RS:WaitForChild("SaveFreecamPresets", 10)
	loadRemote = RS:WaitForChild("LoadFreecamPresets", 10)
	
	if saveRemote and loadRemote then
		task.wait(1)
		loadPresets()
	end
	
	createGUI()
end)

print("[Freecam] Client loaded")
