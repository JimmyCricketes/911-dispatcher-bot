// 911 DISPATCHER BOT - THREAD VERSION
// Host on Railway. app or Render

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');

express().get('/', (req, res) => res.send('Bot Online')).listen(3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

// Track active call threads:  { threadId: { callId, answered } }
const activeThreads = new Map();

// Helper:  Send action to Roblox
async function sendToRoblox(topic, data) {
    try {
        const res = await fetch(
            `https://apis.roblox.com/messaging-service/v1/universes/${process.env.UNIVERSE_ID}/topics/${topic}`,
            {
                method:  'POST',
                headers: { 
                    'x-api-key': process.env.ROBLOX_API_KEY, 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({ message: JSON.stringify(data) })
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
    if (!msg.author.bot || !msg.embeds || msg.embeds.length === 0) return;
    
    const embed = msg.embeds[0];
    
    if (embed.title && embed.title.includes('EMERGENCY CALL - 911')) {
        const statusField = embed.fields?.find(f => f.name && f.name.includes('Status'));
        
        if (statusField && statusField.value && statusField.value.includes('RINGING')) {
            // Extract callId from description
            let callId = 'unknown';
            if (embed.description) {
                const match = embed.description.match(/Call ID:\s*(\S+)/);
                if (match) callId = match[1];
            }
            
            // Extract callback number
            let callbackNumber = 'Unknown';
            const callbackField = embed.fields?.find(f => f.name && f.name.includes('Callback'));
            if (callbackField && callbackField.value) {
                callbackNumber = callbackField.value;
            }
            
            try {
                const thread = await msg.startThread({
                    name: `911 Call - ${callId}`,
                    autoArchiveDuration:  60
                });
                
                activeThreads.set(thread.id, {
                    callId: callId,
                    answered: false
                });
                
                await thread.send(
                    `<@769664717614088193>\n` +
                    `**INCOMING 911 CALL**\n` +
                    `Call ID: ${callId}\n` +
                    `Callback: ${callbackNumber}\n\n` +
                    `Send a message to answer and respond. `
                );
                
            } catch (e) {
                console.error('[Thread Error]:', e);
                await msg.channel.send(`<@769664717614088193> INCOMING 911 CALL - Use !answer ${callId} to connect`);
            }
        }
    }
});

// Handle messages in threads
client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    
    // Check if in active call thread
    if (msg.channel.type === ChannelType.PublicThread || msg.channel.type === ChannelType.PrivateThread) {
        const threadData = activeThreads.get(msg.channel.id);
        
        if (threadData) {
            const { callId, answered } = threadData;
            
            // If not answered yet, answer first
            if (!answered) {
                const success = await sendToRoblox('DispatcherAction', {
                    callId: callId,
                    action:  'answer',
                    dispatcher: msg.author.username
                });
                
                if (success) {
                    threadData.answered = true;
                    activeThreads.set(msg.channel.id, threadData);
                } else {
                    await msg.reply('Failed to connect to call.');
                    return;
                }
            }
            
            // Send message to caller
            const success = await sendToRoblox('DispatcherMessage', {
                callId: callId,
                text: msg.content,
                dispatcher: msg.author.username
            });
            
            if (!success) {
                await msg.reply('Failed');
            }
            
            return;
        }
    }
    
    // Legacy commands
    if (msg.content === '!status') {
        msg.reply('Bot online');
        return;
    }
    
    if (msg.content.startsWith('!answer ')) {
        const callId = msg.content.slice(8).trim();
        if (!callId) {
            msg.reply('Usage: !answer <callId>');
            return;
        }
        const success = await sendToRoblox('DispatcherAction', {
            callId: callId,
            action: 'answer',
            dispatcher: msg.author.username
        });
        msg.reply(success ? 'Sent' : 'Failed');
        return;
    }
    
    if (msg.content.startsWith('!d ')) {
        const args = msg.content.slice(3).trim().split(' ');
        const callId = args.shift();
        const text = args.join(' ');
        if (!callId || !text) {
            msg.reply('Usage: !d <callId> <message>');
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
});

client.once('ready', () => console.log('Bot ready! '));
client.login(process.env.DISCORD_TOKEN);
