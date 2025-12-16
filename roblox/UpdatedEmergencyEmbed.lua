-- Replace your existing buildEmergencyEmbed function with this:
local function buildEmergencyEmbed(log, isLive, callerName, callerNum, logId)
    if not log then return nil end

    local transcriptLines = {}
    for _, m in ipairs(log.messages or {}) do
        if m and m.sender and m.text then
            local prefix = m.sender == "911 Dispatch" and "📞 " or ""
            table.insert(transcriptLines, string.format("%s**%s:** %s", prefix, m.sender, m.text))
        end
    end
    local transcriptText = #transcriptLines > 0 and table.concat(transcriptLines, "\n") or "Awaiting response..."

    local statusText = "ACTIVE"
    if not isLive then statusText = "CALL ENDED"
    elseif log.status == "ringing" then statusText = "RINGING"
    end

    local duration = formatDuration(log.startTime, log.endTime)
    local footer = string.format("Reply: !d %s <message> • %s", logId or "???", os.date("%m/%d/%Y %I:%M %p"))

    return {
        title = "**🚨 EMERGENCY CALL - 911**",
        color = isLive and 16711680 or 8421504,
        fields = {
            {name = "📱 Callback", value = formatPhoneNumber(callerNum) or "Unknown", inline = true},
            {name = "⏱️ Duration", value = duration, inline = true},
            {name = "🔴 Status", value = statusText, inline = true},
            {name = "📝 Transcript", value = transcriptText, inline = false}
        },
        footer = {text = footer}
    }
end
