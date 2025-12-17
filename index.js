// 911 DISPATCHER BOT - THREAD VERSION
// Host on Railway. app for FREE

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');

// Keep-alive server (required for free hosting)
express().get('/', (req, res) => res.send('Bot Online')).listen(3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

// Track active call threads:  { visiblelogId: { threadId, callId, answered } }
const activeThreads = new Map();

// Helper:  Send action to Roblox
async function sendToRoblox(topic, data) {
    try {
        const res = await fetch(
            `https://apis.roblox. com/messaging-service/v1/universes/${process.env. UNIVERSE_ID}/topics/${topic}`,
            {
                method: 'POST',
                headers: { 
                    'x-api-key':  process.env. ROBLOX_API_KEY, 
                    'Content-Type': 'application/json' 
                },
                body: JSON. stringify({ message: JSON.stringify(data) })
            }
        );
        return res.ok;
    } catch (e) {
        console.error(`[Roblox API Error] ${topic}:`, e);
        return false;
    }
}

// Monitor for new 911 call embeds and create threads
client.on('messageCreate', async (msg) => {
    // Check if message is from a webhook (bot) and has embeds
    if (!msg. author.bot || ! msg.embeds || msg.embeds. length === 0) return;
    
    const embed = msg.embeds[0];
    
    // Check if this is an emergency call embed with RINGING status
    if (embed. title && embed.title.includes('EMERGENCY CALL - 911')) {
        const statusField = embed. fields?.find(f => f.name && f.name.includes('Status'));
        
        if (statusField && statusField. value && statusField. value.includes('RINGING')) {
            // Extract callId from description
            let callId = 'unknown';
            if (embed.description) {
                const match = embed.description.match(/Call ID:\s*(\S+)/);
                if (match) callId = match[1];
            }
            
            // Extract callback number
            let callbackNumber = 'Unknown';
            const callbackField = embed.fields?. find(f => f.name && f. name.includes('Callback'));
            if (callbackField && callbackField.value) {
                callbackNumber = callbackField.value;
            }
            
            try {
                // Create a thread for this call
                const thread = await msg.startThread({
                    name: `911 Call - ${callId}`,
                    autoArchiveDuration:  60,
                    reason: `Emergency call from ${callbackNumber}`
                });
                
                // Store thread info
                activeThreads.set(thread.id, {
                    callId: callId,
                    answered: false,
                    messageId: msg.id,
                    callbackNumber: callbackNumber
                });
                
                // Send initial message in thread
                await thread.send(
                    `🚨 **INCOMING 911 CALL**\n` +
                    `**Call ID:** \`${callId}\`\n` +
                    `**Callback:** ${callbackNumber}\n\n` +
                    `<@769664717614088193> - Send a message to answer and respond to the caller. `
                );
                
            } catch (e) {
                console. error('[Thread Creation Error]:', e);
                // Fallback to old behavior
                await msg.channel.send(`<@769664717614088193> INCOMING 911 CALL - Use !answer ${callId} to connect`);
            }
        }
    }
});

// Handle messages in threads - auto-answer on first message, relay all messages
client.on('messageCreate', async (msg) => {
    // Ignore bot messages
    if (msg.author.bot) return;
    
    // Check if this is in an active call thread
    if (msg.channel.type === ChannelType. PublicThread || msg.channel.type === ChannelType. PrivateThread) {
        const threadData = activeThreads. get(msg.channel.id);
        
        if (threadData) {
            const { callId, answered } = threadData;
            
            // If not answered yet, answer the call first
            if (!answered) {
                const answerSuccess = await sendToRoblox('DispatcherAction', {
                    callId: callId,
                    action:  'answer',
                    dispatcher: msg.author. username
                });
                
                if (answerSuccess) {
                    threadData.answered = true;
                    activeThreads.set(msg.channel.id, threadData);
                    await msg.react('✅');
                } else {
                    await msg.reply('⚠️ Failed to connect to call.  The call may have ended.');
                    return;
                }
            }
            
            // Send the message to the caller
            const messageSuccess = await sendToRoblox('DispatcherMessage', {
                callId: callId,
                text: msg.content,
                dispatcher: msg.author. username
            });
            
            if (! messageSuccess) {
                await msg.react('❌');
            }
            
            return;
        }
    }
    
    // Legacy commands (still work outside of threads)
    
    // ! status command
    if (msg.content === '!status') {
        msg.reply('Bot online');
        return;
    }
    
    // !answer <callId> command (legacy)
    if (msg.content. startsWith('!answer ')) {
        const callId = msg.content.slice(8).trim();
        
        if (! callId) {
            msg.reply('Usage: `!answer <callId>`');
            return;
        }
        
        const success = await sendToRoblox('DispatcherAction', {
            callId:  callId,
            action: 'answer',
            dispatcher:  msg.author.username
        });
        
        msg.reply(success ? 'Sent' : 'Failed');
        return;
    }
    
    // ! d <callId> <message> command (legacy)
    if (msg.content.startsWith('!d ')) {
        const args = msg.content. slice(3).trim().split(' ');
        const callId = args. shift();
        const text = args.join(' ');
        
        if (!callId || !text) {
            msg.reply('Usage: `!d <callId> <message>`');
            return;
        }
        
        const success = await sendToRoblox('DispatcherMessage', {
            callId: callId,
            text: text,
            dispatcher:  msg.author.username
        });
        
        msg.reply(success ? 'Sent' : 'Failed');
        return;
    }
    
    // !endcall command (in thread)
    if (msg.content === '!endcall' && msg.channel. isThread()) {
        const threadData = activeThreads.get(msg.channel.id);
        if (threadData) {
            activeThreads.delete(msg.channel.id);
            await msg.reply('Call ended.  Thread will be archived.');
            await msg.channel.setArchived(true);
        }
        return;
    }
});

// Clean up threads when embeds update to "CALL ENDED"
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (! newMsg.author?. bot || !newMsg.embeds || newMsg.embeds. length === 0) return;
    
    const embed = newMsg.embeds[0];
    
    if (embed.title && embed.title.includes('EMERGENCY CALL - 911')) {
        const statusField = embed. fields?.find(f => f.name && f.name.includes('Status'));
        
        if (statusField && statusField. value && statusField. value.includes('CALL ENDED')) {
            // Find and archive the thread
            if (newMsg.hasThread && newMsg.thread) {
                const threadData = activeThreads. get(newMsg. thread.id);
                if (threadData) {
                    await newMsg.thread.send('📴 **Call has ended.**');
                    activeThreads. delete(newMsg. thread.id);
                    
                    // Archive after a short delay
                    setTimeout(async () => {
                        try {
                            await newMsg.thread. setArchived(true);
                        } catch (e) {
                            console.error('[Thread Archive Error]:', e);
                        }
                    }, 5000);
                }
            }
        }
    }
});

client.once('ready', () => console.log('Bot ready!'));
client.login(process.env.DISCORD_TOKEN);
