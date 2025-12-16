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
    if (msg.author.bot || !msg.content.startsWith('!d ')) return;
    
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
        msg.react(res.ok ? '✅' : '❌');
    } catch (e) {
        msg.react('❌');
    }
});

client.once('ready', () => console.log('Bot ready!'));
client.login(process.env.DISCORD_TOKEN);
