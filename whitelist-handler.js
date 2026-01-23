/**
 * Gun Whitelist Handler
 * Add this to your existing Discord bot
 * 
 * Required env vars:
 * - WHITELIST_CHANNEL_ID: Channel where mods can manage whitelist
 * - GIST_ID: Your GitHub Gist ID
 * - GITHUB_TOKEN: GitHub personal access token with gist scope
 */

'use strict';

const https = require('https');

const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WHITELIST_CHANNEL_ID = process.env.WHITELIST_CHANNEL_ID;

// Available guns
const VALID_GUNS = [
    'M1911',
    '.38 SNUBNOSE',
    'M1928 TOMMY GUN',
    'M1897 Shotgun'
];

// Command patterns
const CMD = {
    add: /^!whitelist\s+add\s+(\d+)\s+(.+)$/i,
    remove: /^!whitelist\s+remove\s+(\d+)(?:\s+(.+))?$/i,
    list: /^!whitelist\s+list$/i,
    help: /^!whitelist\s+help$/i,
    lookup: /^!whitelist\s+lookup\s+(\d+)$/i,
};

// In-memory cache
let whitelistCache = {};
let lastSync = 0;

/**
 * Fetch whitelist from GitHub Gist
 */
function fetchGist() {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'User-Agent': 'WhitelistBot',
                'Accept': 'application/vnd.github+json',
            },
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const gist = JSON.parse(data);
                        const content = gist.files['whitelist.json']?.content;
                        resolve(content ? JSON.parse(content) : {});
                    } catch (e) {
                        reject(new Error('Failed to parse gist'));
                    }
                } else {
                    reject(new Error(`Gist fetch failed: ${res.statusCode}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Update GitHub Gist with new whitelist
 */
function updateGist(whitelist) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            files: {
                'whitelist.json': {
                    content: JSON.stringify(whitelist, null, 2)
                }
            }
        });

        const req = https.request({
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'User-Agent': 'WhitelistBot',
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(true);
                } else {
                    reject(new Error(`Gist update failed: ${res.statusCode}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * Sync cache with Gist
 */
async function syncCache() {
    const now = Date.now();
    if (now - lastSync < 5000) return; // Debounce 5s
    try {
        whitelistCache = await fetchGist();
        lastSync = now;
    } catch (e) {
        console.error('Cache sync failed:', e.message);
    }
}

/**
 * Parse gun names from input
 */
function parseGuns(input) {
    const guns = [];
    const normalized = input.toUpperCase();
    
    for (const gun of VALID_GUNS) {
        if (normalized.includes(gun.toUpperCase())) {
            guns.push(gun);
        }
    }
    
    // Also try comma-separated
    if (guns.length === 0) {
        const parts = input.split(/[,;]+/).map(s => s.trim());
        for (const part of parts) {
            const match = VALID_GUNS.find(g => 
                g.toUpperCase() === part.toUpperCase() ||
                g.toUpperCase().includes(part.toUpperCase())
            );
            if (match && !guns.includes(match)) guns.push(match);
        }
    }
    
    return guns;
}

/**
 * Format whitelist for Discord display
 */
function formatList(whitelist) {
    const entries = Object.entries(whitelist);
    if (entries.length === 0) return '*Whitelist is empty*';
    
    const lines = entries.map(([id, data]) => {
        const guns = data.guns.join(', ');
        const name = data.name || 'Unknown';
        return `\`${id}\` (${name}): ${guns}`;
    });
    
    // Split into chunks if too long
    if (lines.join('\n').length > 1900) {
        return lines.slice(0, 30).join('\n') + `\n... and ${lines.length - 30} more`;
    }
    return lines.join('\n');
}

/**
 * Handle whitelist commands
 * Call this from your messageCreate handler
 */
async function handleWhitelistCommand(msg) {
    // Only process in whitelist channel
    if (msg.channel.id !== WHITELIST_CHANNEL_ID) return false;
    if (msg.author.bot) return false;
    
    const content = msg.content.trim();
    let match;
    
    // Help
    if (CMD.help.test(content)) {
        await msg.reply(
            '**Whitelist Commands**\n' +
            '`!whitelist add <userId> <guns>` - Add user with guns\n' +
            '`!whitelist remove <userId> [guns]` - Remove user or specific guns\n' +
            '`!whitelist lookup <userId>` - Check user\'s guns\n' +
            '`!whitelist list` - Show all whitelisted users\n\n' +
            '**Available Guns:** ' + VALID_GUNS.join(', ')
        );
        return true;
    }
    
    // List
    if (CMD.list.test(content)) {
        await syncCache();
        await msg.reply('**Current Whitelist:**\n' + formatList(whitelistCache));
        return true;
    }
    
    // Lookup
    match = content.match(CMD.lookup);
    if (match) {
        await syncCache();
        const userId = match[1];
        const entry = whitelistCache[userId];
        if (entry) {
            await msg.reply(`**User ${userId}** (${entry.name || 'Unknown'}):\n${entry.guns.join(', ')}`);
        } else {
            await msg.reply(`User \`${userId}\` is not whitelisted.`);
        }
        return true;
    }
    
    // Add
    match = content.match(CMD.add);
    if (match) {
        const userId = match[1];
        const gunInput = match[2];
        const guns = parseGuns(gunInput);
        
        if (guns.length === 0) {
            await msg.reply(`No valid guns found. Available: ${VALID_GUNS.join(', ')}`);
            return true;
        }
        
        await syncCache();
        
        if (whitelistCache[userId]) {
            // Merge guns
            const existing = whitelistCache[userId].guns || [];
            const merged = [...new Set([...existing, ...guns])];
            whitelistCache[userId].guns = merged;
            whitelistCache[userId].updatedBy = msg.author.username;
            whitelistCache[userId].updatedAt = new Date().toISOString();
        } else {
            whitelistCache[userId] = {
                guns,
                name: null, // Can be filled in manually or via Roblox API
                addedBy: msg.author.username,
                addedAt: new Date().toISOString(),
            };
        }
        
        try {
            await updateGist(whitelistCache);
            await msg.reply(`✅ Added \`${userId}\` with guns: ${guns.join(', ')}`);
        } catch (e) {
            await msg.reply(`❌ Failed to update: ${e.message}`);
        }
        return true;
    }
    
    // Remove
    match = content.match(CMD.remove);
    if (match) {
        const userId = match[1];
        const gunInput = match[2];
        
        await syncCache();
        
        if (!whitelistCache[userId]) {
            await msg.reply(`User \`${userId}\` is not whitelisted.`);
            return true;
        }
        
        if (gunInput) {
            // Remove specific guns
            const gunsToRemove = parseGuns(gunInput);
            whitelistCache[userId].guns = whitelistCache[userId].guns.filter(
                g => !gunsToRemove.includes(g)
            );
            
            if (whitelistCache[userId].guns.length === 0) {
                delete whitelistCache[userId];
                await msg.reply(`✅ Removed \`${userId}\` entirely (no guns left)`);
            } else {
                await msg.reply(`✅ Removed guns from \`${userId}\`: ${gunsToRemove.join(', ')}`);
            }
        } else {
            // Remove entirely
            delete whitelistCache[userId];
            await msg.reply(`✅ Removed \`${userId}\` from whitelist`);
        }
        
        try {
            await updateGist(whitelistCache);
        } catch (e) {
            await msg.reply(`❌ Failed to update: ${e.message}`);
        }
        return true;
    }
    
    return false;
}

/**
 * Initialize - call this after bot is ready
 */
async function initWhitelist() {
    if (!GIST_ID || !GITHUB_TOKEN) {
        console.warn('[Whitelist] Missing GIST_ID or GITHUB_TOKEN');
        return false;
    }
    try {
        await syncCache();
        console.log(`[Whitelist] Loaded ${Object.keys(whitelistCache).length} entries`);
        return true;
    } catch (e) {
        console.error('[Whitelist] Init failed:', e.message);
        return false;
    }
}

module.exports = {
    handleWhitelistCommand,
    initWhitelist,
    syncCache,
    VALID_GUNS,
};
