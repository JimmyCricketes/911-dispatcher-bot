--[[
    Gun Whitelist Sync Plugin
    Install: Save to %localappdata%\Roblox\Plugins\WhitelistSyncPlugin.lua
    
    Configure GIST_ID below with your GitHub Gist ID
    The Gist must be PUBLIC for HttpService to fetch it
]]

local GIST_ID = "YOUR_GIST_ID_HERE" -- Replace with your Gist ID
local SCRIPT_PATH = "ServerScriptService.GunGiver" -- Path to your gun giver script

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local toolbar = plugin:CreateToolbar("Whitelist Sync")
local syncButton = toolbar:CreateButton(
    "Sync Whitelist",
    "Fetch whitelist from Discord and update script",
    "rbxassetid://6031280882"
)
local previewButton = toolbar:CreateButton(
    "Preview",
    "Preview whitelist without applying",
    "rbxassetid://6031280871"
)

local GIST_URL = "https://gist.githubusercontent.com/raw/" .. GIST_ID .. "/whitelist.json"

-- Fetch whitelist from Gist
local function fetchWhitelist()
    local success, result = pcall(function()
        return HttpService:GetAsync(GIST_URL .. "?t=" .. os.time()) -- Cache bust
    end)
    
    if not success then
        warn("[WhitelistSync] Failed to fetch: " .. tostring(result))
        return nil
    end
    
    local parseSuccess, data = pcall(function()
        return HttpService:JSONDecode(result)
    end)
    
    if not parseSuccess then
        warn("[WhitelistSync] Failed to parse JSON: " .. tostring(data))
        return nil
    end
    
    return data
end

-- Convert JSON whitelist to Lua table string
local function generateLuaTable(whitelist)
    local lines = {"local UserIDs = {"}
    
    -- Sort by user ID for consistency
    local sortedIds = {}
    for id in pairs(whitelist) do
        table.insert(sortedIds, id)
    end
    table.sort(sortedIds, function(a, b) return tonumber(a) < tonumber(b) end)
    
    for _, id in ipairs(sortedIds) do
        local entry = whitelist[id]
        local guns = entry.guns or {}
        local name = entry.name or "unknown"
        
        -- Format guns array
        local gunStrings = {}
        for _, gun in ipairs(guns) do
            table.insert(gunStrings, '"' .. gun .. '"')
        end
        
        local line = string.format('\t[%s] = {%s}, --%s', 
            id, 
            table.concat(gunStrings, ", "),
            name
        )
        table.insert(lines, line)
    end
    
    table.insert(lines, "}")
    return table.concat(lines, "\n")
end

-- Find the target script
local function findScript()
    local parts = string.split(SCRIPT_PATH, ".")
    local current = game
    
    for _, part in ipairs(parts) do
        current = current:FindFirstChild(part)
        if not current then
            return nil
        end
    end
    
    if current:IsA("LuaSourceContainer") then
        return current
    end
    return nil
end

-- Update script source with new whitelist
local function updateScript(script, newTable)
    local source = script.Source
    
    -- Find the UserIDs table in the source
    local startPattern = "local%s+UserIDs%s*=%s*{"
    local startPos = source:find(startPattern)
    
    if not startPos then
        warn("[WhitelistSync] Could not find 'local UserIDs = {' in script")
        return false
    end
    
    -- Find the matching closing brace
    local braceCount = 0
    local endPos = startPos
    local inString = false
    local stringChar = nil
    
    for i = startPos, #source do
        local char = source:sub(i, i)
        local prevChar = i > 1 and source:sub(i-1, i-1) or ""
        
        -- Track string state
        if (char == '"' or char == "'") and prevChar ~= "\\" then
            if not inString then
                inString = true
                stringChar = char
            elseif char == stringChar then
                inString = false
                stringChar = nil
            end
        end
        
        if not inString then
            if char == "{" then
                braceCount = braceCount + 1
            elseif char == "}" then
                braceCount = braceCount - 1
                if braceCount == 0 then
                    endPos = i
                    break
                end
            end
        end
    end
    
    if braceCount ~= 0 then
        warn("[WhitelistSync] Could not find matching closing brace")
        return false
    end
    
    -- Replace the table
    local before = source:sub(1, startPos - 1)
    local after = source:sub(endPos + 1)
    
    script.Source = before .. newTable .. after
    return true
end

-- Preview widget
local previewWidget = nil

local function showPreview(luaTable, entryCount)
    if previewWidget then
        previewWidget:Destroy()
    end
    
    local widgetInfo = DockWidgetPluginGuiInfo.new(
        Enum.InitialDockState.Float,
        true, false,
        500, 400,
        300, 200
    )
    
    previewWidget = plugin:CreateDockWidgetPluginGui("WhitelistPreview", widgetInfo)
    previewWidget.Title = "Whitelist Preview (" .. entryCount .. " entries)"
    
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(1, 0, 1, 0)
    frame.BackgroundColor3 = Color3.fromRGB(40, 40, 40)
    frame.Parent = previewWidget
    
    local scroll = Instance.new("ScrollingFrame")
    scroll.Size = UDim2.new(1, -20, 1, -60)
    scroll.Position = UDim2.new(0, 10, 0, 10)
    scroll.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
    scroll.BorderSizePixel = 0
    scroll.ScrollBarThickness = 8
    scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
    scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
    scroll.Parent = frame
    
    local textBox = Instance.new("TextBox")
    textBox.Size = UDim2.new(1, -10, 0, 0)
    textBox.Position = UDim2.new(0, 5, 0, 5)
    textBox.AutomaticSize = Enum.AutomaticSize.Y
    textBox.BackgroundTransparency = 1
    textBox.TextColor3 = Color3.fromRGB(200, 200, 200)
    textBox.Font = Enum.Font.Code
    textBox.TextSize = 12
    textBox.TextXAlignment = Enum.TextXAlignment.Left
    textBox.TextYAlignment = Enum.TextYAlignment.Top
    textBox.TextEditable = false
    textBox.ClearTextOnFocus = false
    textBox.TextWrapped = false
    textBox.Text = luaTable
    textBox.Parent = scroll
    
    local applyBtn = Instance.new("TextButton")
    applyBtn.Size = UDim2.new(0, 100, 0, 30)
    applyBtn.Position = UDim2.new(0.5, -110, 1, -45)
    applyBtn.BackgroundColor3 = Color3.fromRGB(0, 170, 0)
    applyBtn.TextColor3 = Color3.new(1, 1, 1)
    applyBtn.Font = Enum.Font.GothamBold
    applyBtn.TextSize = 14
    applyBtn.Text = "Apply"
    applyBtn.Parent = frame
    
    local closeBtn = Instance.new("TextButton")
    closeBtn.Size = UDim2.new(0, 100, 0, 30)
    closeBtn.Position = UDim2.new(0.5, 10, 1, -45)
    closeBtn.BackgroundColor3 = Color3.fromRGB(170, 0, 0)
    closeBtn.TextColor3 = Color3.new(1, 1, 1)
    closeBtn.Font = Enum.Font.GothamBold
    closeBtn.TextSize = 14
    closeBtn.Text = "Cancel"
    closeBtn.Parent = frame
    
    closeBtn.MouseButton1Click:Connect(function()
        previewWidget:Destroy()
        previewWidget = nil
    end)
    
    applyBtn.MouseButton1Click:Connect(function()
        local targetScript = findScript()
        if not targetScript then
            warn("[WhitelistSync] Script not found at: " .. SCRIPT_PATH)
            return
        end
        
        ChangeHistoryService:SetWaypoint("Before Whitelist Update")
        
        if updateScript(targetScript, luaTable) then
            ChangeHistoryService:SetWaypoint("After Whitelist Update")
            print("[WhitelistSync] ✅ Updated " .. entryCount .. " whitelist entries")
            Selection:Set({targetScript})
        else
            warn("[WhitelistSync] Failed to update script")
        end
        
        previewWidget:Destroy()
        previewWidget = nil
    end)
end

-- Sync button handler
syncButton.Click:Connect(function()
    print("[WhitelistSync] Fetching whitelist...")
    
    local whitelist = fetchWhitelist()
    if not whitelist then
        warn("[WhitelistSync] Failed to fetch whitelist")
        return
    end
    
    local entryCount = 0
    for _ in pairs(whitelist) do entryCount = entryCount + 1 end
    
    local luaTable = generateLuaTable(whitelist)
    
    local targetScript = findScript()
    if not targetScript then
        warn("[WhitelistSync] Script not found at: " .. SCRIPT_PATH)
        warn("[WhitelistSync] Edit SCRIPT_PATH in plugin if path is different")
        return
    end
    
    ChangeHistoryService:SetWaypoint("Before Whitelist Update")
    
    if updateScript(targetScript, luaTable) then
        ChangeHistoryService:SetWaypoint("After Whitelist Update")
        print("[WhitelistSync] ✅ Updated " .. entryCount .. " whitelist entries")
        Selection:Set({targetScript})
    else
        warn("[WhitelistSync] Failed to update script")
    end
end)

-- Preview button handler
previewButton.Click:Connect(function()
    print("[WhitelistSync] Fetching whitelist for preview...")
    
    local whitelist = fetchWhitelist()
    if not whitelist then
        warn("[WhitelistSync] Failed to fetch whitelist")
        return
    end
    
    local entryCount = 0
    for _ in pairs(whitelist) do entryCount = entryCount + 1 end
    
    local luaTable = generateLuaTable(whitelist)
    showPreview(luaTable, entryCount)
end)

print("[WhitelistSync] Plugin loaded. Configure GIST_ID if not already set.")
