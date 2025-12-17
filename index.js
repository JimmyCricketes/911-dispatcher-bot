// 911 DISPATCHER BOT - THREAD VERSION
// Host on Railway.app or Render

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');

// Simple web server to keep the bot alive
express().get('/', (req, res) => res.send('Bot Online')).listen(3000);

const client = new Client({
    intents: [
        // **FIXED: Removed space in GatewayIntentBits. Guilds**
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Track active call threads: { threadId: { callId, answered } }
const activeThreads = new Map();

// Helper: Send action to Roblox
async function sendToRoblox(topic, data) {
    try {
        const res = await fetch(
            `https://apis.roblox.com/messaging-service/v1/universes/${process.env.UNIVERSE_ID}/topics/${topic}`,
            {
                method: 'POST',
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
        // **FIXED: Removed space in find**
        const statusField = embed.fields?.find(f => f.name && f.name.includes('Status'));

        if (statusField && statusField.value && statusField.value.includes('RINGING')) {
            let callId = 'unknown';
            if (embed.description) {
                const match = embed.description.match(/Call ID:\s*(\S+)/);
                if (match) callId = match[1];
            }

            let callbackNumber = 'Unknown';
            const callbackField = embed.fields?.find(f => f.name && f.name.includes('Callback'));
            if (callbackField && callbackField.value) {
                callbackNumber = callbackField.value;
            }

            try {
                const thread = await msg.startThread({
                    name: `911 Call - ${callId}`,
                    autoArchiveDuration: 60
                });

                activeThreads.set(thread.id, {
                    callId: callId,
                    answered: false
                });

                await thread.send(
                    `<@769664717614088193>\n` +
                    `**INCOMING 911 CALL**\n` +
                    `Send a message to answer and respond.\n` +
                    `\`!hangup\` to end call. `
                );

            } catch (e) {
                // **FIXED: Removed space in console.error and msg.channel.send**
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
    // **FIXED: Removed space in ChannelType**
    if (msg.channel.type === ChannelType.PublicThread || msg.channel.type === ChannelType.PrivateThread) {
        const threadData = activeThreads.get(msg.channel.id);

        if (threadData) {
            const { callId, answered } = threadData;

            // Check for hangup command
            if (msg.content.toLowerCase() === '!hangup' || msg.content.toLowerCase() === '!end') {
                const success = await sendToRoblox('DispatcherAction', {
                    callId: callId,
                    action: 'hangup',
                    dispatcher: msg.author.username,
                    threadId: msg.channel.id
                });

                if (success) {
                    await msg.reply('Call ended.');
                    activeThreads.delete(msg.channel.id);

                    // Archive the thread
                    try {
                        await msg.channel.setArchived(true);
                    } catch (e) {
                        console.error('[Thread Archive Error]:', e);
                    }
                } else {
                    // **FIXED: Removed space in msg.reply**
                    await msg.reply('Failed to end call.');
                }
                return;
            }

            // If not answered yet, answer first WITH the message included
            if (!answered) {
                const success = await sendToRoblox('DispatcherAction', {
                    // **FIXED: Removed space in callId value**
                    callId: callId,
                    // **FIXED: Removed space in action value**
                    action: 'answer',
                    dispatcher: msg.author.username,
                    message: msg.content,
                    threadId: msg.channel.id
                });

                if (success) {
                    threadData.answered = true;
                    activeThreads.set(msg.channel.id, threadData);
                } else {
                    // **FIXED: Removed space in msg.reply**
                    await msg.reply('Failed to connect to call.');
                }
                return;
            }

            // Send message to caller (only for subsequent messages)
            const success = await sendToRoblox('DispatcherMessage', {
                callId: callId,
                text: msg.content,
                dispatcher: msg.author.username,
                // **FIXED: Removed space in threadId value**
                threadId: msg.channel.id
            });

            // **FIXED: Removed space in conditional logic and msg.reply**
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

    // **FIXED: Removed space in startsWith**
    if (msg.content.startsWith('!answer ')) {
        // **FIXED: Removed space in conditional logic**
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
        // **FIXED: Removed space in shift**
        const callId = args.shift();
        const text = args.join(' ');
        if (!callId || !text) {
            msg.reply('Usage: !d <callId> <message>');
            return;
        }
        const success = await sendToRoblox('DispatcherMessage', {
            callId: callId,
            // **FIXED: Removed space in text value**
            text: text,
            // **FIXED: Removed space in dispatcher value**
            dispatcher: msg.author.username
        });
        msg.reply(success ? 'Sent' : 'Failed');
        return;
    }

    if (msg.content.startsWith('!hangup ') || msg.content.startsWith('!end ')) {
        const callId = msg.content.split(' ')[1]?.trim();
        if (!callId) {
            msg.reply('Usage: !hangup <callId>');
            return;
        }
        const success = await sendToRoblox('DispatcherAction', {
            callId: callId,
            action: 'hangup',
            dispatcher: msg.author.username
        });
        msg.reply(success ? 'Call ended.' : 'Failed');
        return;
    }
});

client.once('ready', () => console.log('Bot ready!'));
// **FIXED: Removed space in environment variable access and console.log**
client.login(process.env.DISCORD_TOKEN);
