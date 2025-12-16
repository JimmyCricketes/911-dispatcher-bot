// 911 DISPATCHER BOT - MINIMAL VERSION
// Host on Railway.app for FREE

const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Keep-alive server (required for free hosting)
express().get('/', (req, res) => res.send('Bot Online')).listen(3000);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Command: !d <callId> <message>
client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    
    // !status command
    if (msg.content === '!status') {
        msg.reply('Bot online');
        return;
    }
    
    // !answer <callId> command
    if (msg.content.startsWith('!answer ')) {
        const callId = msg.content.slice(8).trim();
        
        if (!callId) {
            msg.reply('Usage: `!answer <callId>`');
            return;
        }
        
        try {
            const res = await fetch(
                `https://apis.roblox.com/messaging-service/v1/universes/${process.env.UNIVERSE_ID}/topics/DispatcherAction`,
                {
                    method: 'POST',
                    headers: { 'x-api-key': process.env.ROBLOX_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: JSON.stringify({ callId, action: 'answer', dispatcher: msg.author.username }) })
                }
            );
            msg.reply(res.ok ? 'Sent' : 'Failed');
        } catch (e) {
            msg.reply('Failed');
        }
        return;
    }
    
    // !d <callId> <message> command
    if (msg.content.startsWith('!d ')) {
        const args = msg.content.slice(3).trim().split(' ');
        const callId = args.shift();
        const text = args.join(' ');
        
        if (!callId || !text) {
            msg.reply('Usage: `!d <callId> <message>`');
            return;
        }
        
        try {
            const res = await fetch(
                `https://apis.roblox.com/messaging-service/v1/universes/${process.env.UNIVERSE_ID}/topics/DispatcherMessage`,
                {
                    method: 'POST',
                    headers: { 'x-api-key': process.env.ROBLOX_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: JSON.stringify({ callId, text, dispatcher: msg.author.username }) })
                }
            );
            msg.reply(res.ok ? 'Sent' : 'Failed');
        } catch (e) {
            msg.reply('Failed');
        }
    }
});

// Monitor for new 911 call embeds and auto-ping
client.on('messageCreate', async (msg) => {
    // Check if message is from a webhook (bot) and has embeds
    if (!msg.author.bot || !msg.embeds || msg.embeds.length === 0) return;
    
    const embed = msg.embeds[0];
    
    // Check if this is an emergency call embed with RINGING status
    if (embed.title && embed.title.includes('EMERGENCY CALL - 911')) {
        const statusField = embed.fields?.find(f => f.name && f.name.includes('Status'));
        
        if (statusField && statusField.value && statusField.value.includes('RINGING')) {
            // Extract callId from footer
            let callId = 'unknown';
            if (embed.footer && embed.footer.text) {
                const match = embed.footer.text.match(/!d\s+(\S+)/);
                if (match) callId = match[1];
            }
            
            // Send ping message
            await msg.channel.send(`<@769664717614088193> INCOMING 911 CALL - Use !answer ${callId} to connect`);
        }
    }
});

client.once('ready', () => console.log('Bot ready!'));
client.login(process.env.DISCORD_TOKEN);
