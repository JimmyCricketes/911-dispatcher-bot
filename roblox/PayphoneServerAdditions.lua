--[[
    DISPATCHER COMMUNICATION SYSTEM
    Add this code to your PayphoneServer script
    
    Prerequisites:
    - MessagingService must be enabled
    - HttpService must be enabled for JSONDecode
]]

local MessagingService = game:GetService("MessagingService")

-- Add this function to receive dispatcher messages from Discord
local function setupDispatcherListener()
    -- Listen for dispatcher messages
    pcall(function()
        MessagingService:SubscribeAsync("DispatcherMessage", function(message)
            local data = HttpService:JSONDecode(message.Data)
            if not data or not data.callId or not data.text then return end
            
            -- Find the emergency call
            for logId, log in pairs(logs) do
                if log.isEmergency and log.status == "connected" then
                    -- Match by logId OR by caller's phone number
                    local match = (logId == data.callId)
                    if not match then
                        for _, phoneNum in pairs(log.participantNames or {}) do
                            if phoneNum == data.callId or formatPhoneNumber(phoneNum) == data.callId then
                                match = true
                                break
                            end
                        end
                    end
                    
                    if match then
                        -- Add to transcript
                        table.insert(log.messages, {
                            sender = "911 Dispatch",
                            text = data.text,
                            time = tick()
                        })
                        
                        -- Send to caller
                        for uid in pairs(log.participants or {}) do
                            local p = getPlayer(uid)
                            if p then fire(R.ReceiveMessage, p, "911 Dispatch", data.text) end
                        end
                        return
                    end
                end
            end
        end)
    end)
    
    -- Listen for dispatcher actions (e.g., answer call)
    pcall(function()
        MessagingService:SubscribeAsync("DispatcherAction", function(message)
            local data = HttpService:JSONDecode(message.Data)
            if not data or not data.callId or not data.action then return end
            
            -- Find the emergency call
            for logId, log in pairs(logs) do
                if log.isEmergency and log.status == "ringing" then
                    -- Match by logId OR by caller's phone number
                    local match = (logId == data.callId)
                    if not match then
                        for _, phoneNum in pairs(log.participantNames or {}) do
                            if phoneNum == data.callId or formatPhoneNumber(phoneNum) == data.callId then
                                match = true
                                break
                            end
                        end
                    end
                    
                    if match and data.action == "answer" then
                        -- Answer the call (change status to connected)
                        log.status = "connected"
                        
                        -- Add to transcript
                        table.insert(log.messages, {
                            sender = "System",
                            text = "Dispatcher " .. (data.dispatcher or "Unknown") .. " answered the call",
                            time = tick()
                        })
                        
                        -- Notify the caller
                        for uid in pairs(log.participants or {}) do
                            local p = getPlayer(uid)
                            if p then fire(R.ReceiveMessage, p, "911 Dispatch", "Dispatcher connected") end
                        end
                        return
                    end
                end
            end
        end)
    end)
    
    print("[Payphone Server] Dispatcher listener active")
end

-- Call this at the bottom of your PayphoneServer script
setupDispatcherListener()
