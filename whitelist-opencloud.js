/**
 * Gun Whitelist Handler - Open Cloud Version
 * Updates Roblox DataStore directly via Open Cloud API
 * 
 * Required env vars:
 * - WHITELIST_CHANNEL_ID: Channel where mods can manage whitelist
 * - ROBLOX_UNIVERSE_ID: Your game's Universe ID
 * - ROBLOX_DATASTORE_KEY: Open Cloud API key with DataStore access
 */

'use strict';

const https = require('https');
const crypto = require('crypto');

const ROBLOX_UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID || process.env.UNIVERSE_ID;
const ROBLOX_DATASTORE_KEY = process.env.ROBLOX_DATASTORE_KEY || process.env.ROBLOX_API_KEY;
const WHITELIST_CHANNEL_ID = process.env.WHITELIST_CHANNEL_ID;

const DATASTORE_NAME = 'GunWhitelist';
const ENTRY_KEY = 'whitelist_v1';

// Available guns
const VALID_GUNS = [
    'M1911',
    '.38 SNUBNOSE',
    'M1928 TOMMY GUN',
    'M1897 Shotgun',
    'M1 Carbine'
];

// Command patterns
const CMD = {
    add: /^!whitelist\s+add\s+(\d+)\s+(.+)$/i,
    remove: /^!whitelist\s+remove\s+(\d+)(?:\s+(.+))?$/i,
    list: /^!whitelist\s+list$/i,
    listAll: /^!whitelist\s+all$/i,
    help: /^!whitelist\s+help$/i,
    lookup: /^!whitelist\s+lookup\s+(\d+)$/i,
    sync: /^!whitelist\s+sync$/i,
};

// Hardcoded whitelist (mirror of Studio script for display purposes)
const HARDCODED_USERS = {
    3274640368: {name: "chuhkee_moss", guns: ["M1911", "M1928 TOMMY GUN"]},
    1465067028: {name: "vud", guns: [".38 SNUBNOSE"]},
    56548114: {name: "interstellarriptide", guns: [".38 SNUBNOSE"]},
    1834081320: {name: "makai", guns: ["M1911", ".38 SNUBNOSE"]},
    24749217: {name: "OGSnipes20", guns: [".38 SNUBNOSE", "M1911"]},
    810924509: {name: "dirtsocksguy", guns: [".38 SNUBNOSE", "M1911"]},
    1131986134: {name: "EngIishBloke", guns: [".38 SNUBNOSE", "M1911", "M1897 Shotgun"]},
    2583816107: {name: "mossmanV3", guns: ["M1911"]},
    56444111: {name: "Triggered_Guy", guns: ["M1911", "M1897 Shotgun", ".38 SNUBNOSE"]},
    317024926: {name: "Oldraelew", guns: ["M1911"]},
    2617148664: {name: "almightyzane", guns: ["M1911", ".38 SNUBNOSE"]},
    1780276456: {name: "ffjosephii", guns: [".38 SNUBNOSE"]},
    417784525: {name: "irwb", guns: [".38 SNUBNOSE"]},
    388744626: {name: "Bigsquidz", guns: ["M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN", "M1897 Shotgun"]},
    469068528: {name: "lukas24422", guns: ["M1911", ".38 SNUBNOSE", "M1897 Shotgun"]},
    1159919315: {name: "TheMeep_MeepGaming", guns: ["M1911"]},
    8797665761: {name: "NickyParisi", guns: [".38 SNUBNOSE"]},
    3433914248: {name: "elpepo_facha", guns: [".38 SNUBNOSE", "M1897 Shotgun"]},
    8909620314: {name: "BambukoRebel", guns: [".38 SNUBNOSE", "M1911", "M1897 Shotgun"]},
    1732659616: {name: "b0edser", guns: ["M1911"]},
    3597328590: {name: "Lettuce_Funky0", guns: [".38 SNUBNOSE"]},
    1424337553: {name: "ibexe_king", guns: ["M1911", "M1928 TOMMY GUN", ".38 SNUBNOSE"]},
    1417614457: {name: "L0RENZO121", guns: [".38 SNUBNOSE"]},
    1846610781: {name: "Kejiwafen", guns: [".38 SNUBNOSE", "M1911"]},
    1464679925: {name: "ioanekingpro98", guns: [".38 SNUBNOSE", "M1897 Shotgun"]},
    1830147413: {name: "Mr_Qbama", guns: ["M1911", ".38 SNUBNOSE", "M1897 Shotgun"]},
    3170949659: {name: "RonaldCMorrison", guns: ["M1911", ".38 SNUBNOSE"]},
    1351071106: {name: "gen_wrigs124", guns: [".38 SNUBNOSE"]},
    1776017244: {name: "proboxgamer2013", guns: [".38 SNUBNOSE"]},
    955487965: {name: "firekiller326", guns: [".38 SNUBNOSE"]},
    814007398: {name: "galaxyboy_10000", guns: [".38 SNUBNOSE", "M1897 Shotgun"]},
    2263443634: {name: "Ninja12361961", guns: [".38 SNUBNOSE"]},
    986511712: {name: "TheFalling_FireStar", guns: [".38 SNUBNOSE"]},
    445512125: {name: "ThiefenX", guns: [".38 SNUBNOSE"]},
    1638404386: {name: "Anarchbund", guns: [".38 SNUBNOSE"]},
    223857801: {name: "Skeletonik", guns: ["M1911"]},
    544836564: {name: "IDJLOVER_9231", guns: [".38 SNUBNOSE"]},
    27471332: {name: "Ludakres", guns: [".38 SNUBNOSE"]},
    1696974243: {name: "coop_32123", guns: [".38 SNUBNOSE", "M1911"]},
    3292035980: {name: "resoLsIorceN", guns: ["M1911"]},
    1508649283: {name: "AllAboutToday2", guns: [".38 SNUBNOSE", "M1897 Shotgun"]},
    1441492550: {name: "S1NISTERREALITY", guns: [".38 SNUBNOSE"]},
    1844464778: {name: "IStoleYourBread12121", guns: ["M1911"]},
    3587568832: {name: "Bob_CoolPlay", guns: [".38 SNUBNOSE"]},
    4419542026: {name: "VHSClassics", guns: [".38 SNUBNOSE"]},
    1637989816: {name: "UntilTheFlagStands", guns: ["M1911"]},
    218499531: {name: "GGG12893", guns: ["M1911", "M1928 TOMMY GUN"]},
    9519389212: {name: "RexkVaush", guns: ["M1911"]},
    317824065: {name: "fordshelby", guns: [".38 SNUBNOSE"]},
    113794875: {name: "Hacksaw307", guns: ["M1911", ".38 SNUBNOSE"]},
    246411829: {name: "redkillertank", guns: [".38 SNUBNOSE"]},
    3118272583: {name: "yeahmateaye", guns: [".38 SNUBNOSE"]},
    15630577: {name: "connor030904", guns: [".38 SNUBNOSE", "M1897 Shotgun", "M1928 TOMMY GUN"]},
    1361319250: {name: "Fawhausten", guns: ["M1911"]},
    5813348341: {name: "XenoZuccx", guns: [".38 SNUBNOSE", "M1911"]},
    424244958: {name: "Tezreta", guns: ["M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN", "M1897 Shotgun"]},
    1756102589: {name: "Farrell022", guns: [".38 SNUBNOSE"]},
    1851718638: {name: "OrangeBlossom", guns: ["M1897 Shotgun"]},
    866995178: {name: "HarlowlGuess", guns: ["M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN"]},
    85658932: {name: "Sluger20067", guns: ["M1928 TOMMY GUN"]},
    105121893: {name: "Abyssal_deep", guns: ["M1911"]},
    89366796: {name: "IvorySturm", guns: ["M1928 TOMMY GUN"]},
    74456629: {name: "stopplayingpretend", guns: [".38 SNUBNOSE"]},
    5146105380: {name: "JibMan224", guns: [".38 SNUBNOSE"]},
    323942279: {name: "dreadedsabercut", guns: ["M1911"]},
    159862881: {name: "Nikkov_1", guns: ["M1897 Shotgun", "M1911"]},
    435924445: {name: "ammsjer", guns: ["M1911", "M1928 TOMMY GUN", "M1897 Shotgun"]},
    5224923521: {name: "Wildcard_858", guns: ["M1911"]},
    8336515931: {name: "Brolyfan98", guns: [".38 SNUBNOSE"]},
    1951308725: {name: "koyslop", guns: ["M1911"]},
    1976569166: {name: "CubeTheHoly", guns: [".38 SNUBNOSE"]},
};

// In-memory cache
let whitelistCache = {};

// Prevent duplicate message processing - use global symbol for singleton
const PROCESSED_KEY = Symbol.for('whitelist.processedMessages');
const PROCESSING_KEY = Symbol.for('whitelist.processingMessages');
const RATELIMIT_KEY = Symbol.for('whitelist.userRateLimits');

if (!global[PROCESSED_KEY]) {
    global[PROCESSED_KEY] = new Map(); // msgId -> timestamp
}
if (!global[PROCESSING_KEY]) {
    global[PROCESSING_KEY] = new Set();
}
if (!global[RATELIMIT_KEY]) {
    global[RATELIMIT_KEY] = new Map(); // odiserId -> timestamp
}

const processedMessages = global[PROCESSED_KEY];
const processingMessages = global[PROCESSING_KEY];
const userRateLimits = global[RATELIMIT_KEY];
const MAX_PROCESSED = 1000;
const PROCESSED_TTL_MS = 300000; // 5 min
const RATE_LIMIT_MS = 2000; // 2 sec between commands per user

/**
 * Fetch Roblox username from user ID
 */
function fetchRobloxUsername(userId) {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'users.roblox.com',
            path: `/v1/users/${userId}`,
            method: 'GET',
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.name || null);
                    } catch {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

/**
 * Make Open Cloud DataStore request with retry
 */
const DS_RETRIES = 3;
const DS_BASE_DELAY_MS = 1000;

async function datastoreRequest(method, entryKey, data = null) {
    for (let attempt = 1; attempt <= DS_RETRIES; attempt++) {
        try {
            return await datastoreRequestOnce(method, entryKey, data);
        } catch (err) {
            if (attempt < DS_RETRIES) {
                const delay = DS_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
                console.warn(`[Whitelist] DataStore retry ${attempt}/${DS_RETRIES}: ${err.message}`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
}

function datastoreRequestOnce(method, entryKey, data = null) {
    return new Promise((resolve, reject) => {
        const basePath = `/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
        const query = `?datastoreName=${encodeURIComponent(DATASTORE_NAME)}&entryKey=${encodeURIComponent(entryKey)}`;
        
        const headers = {
            'x-api-key': ROBLOX_DATASTORE_KEY,
        };

        let body = null;
        if (data) {
            body = JSON.stringify(data);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(body);
            headers['content-md5'] = crypto.createHash('md5').update(body).digest('base64');
        }

        const options = {
            hostname: 'apis.roblox.com',
            path: basePath + query,
            method: method,
            headers: headers,
            timeout: 10000,
        };

        const req = https.request(options, res => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(responseData ? JSON.parse(responseData) : {});
                    } catch {
                        resolve(responseData);
                    }
                } else if (res.statusCode === 404) {
                    resolve(null); // Entry doesn't exist yet
                } else if (res.statusCode === 429 || res.statusCode >= 500) {
                    reject(new Error(`Retryable: ${res.statusCode}`));
                } else {
                    reject(new Error(`DataStore error: ${res.statusCode} - ${responseData}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

/**
 * Get whitelist from DataStore
 */
async function getWhitelist() {
    try {
        const data = await datastoreRequest('GET', ENTRY_KEY);
        return data || {};
    } catch (e) {
        console.error('[Whitelist] Failed to get:', e.message);
        return {};
    }
}

/**
 * Save whitelist to DataStore
 */
async function saveWhitelist(whitelist) {
    try {
        await datastoreRequest('POST', ENTRY_KEY, whitelist);
        whitelistCache = whitelist;
        return true;
    } catch (e) {
        console.error('[Whitelist] Failed to save:', e.message);
        return false;
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
    if (entries.length === 0) return '*No runtime entries (check hardcoded list in script)*';
    
    const lines = entries.map(([id, data]) => {
        const guns = (data.guns || []).join(', ');
        const name = data.name || 'Unknown';
        return `\`${id}\` (${name}): ${guns}`;
    });
    
    if (lines.join('\n').length > 1900) {
        return lines.slice(0, 30).join('\n') + `\n... and ${lines.length - 30} more`;
    }
    return lines.join('\n');
}

/**
 * Handle whitelist commands
 */
async function handleWhitelistCommand(msg) {
    // Check channel and basic filters first (fast exit)
    if (msg.channel.id !== WHITELIST_CHANNEL_ID) return false;
    if (msg.author.bot) return false;
    
    const content = msg.content.trim();
    if (!content.startsWith('!whitelist')) return false;
    
    // Prevent duplicate processing with mutex-like pattern
    if (processedMessages.has(msg.id)) {
        console.log('[Whitelist] BLOCKED duplicate (already processed):', msg.id);
        return true;
    }
    if (processingMessages.has(msg.id)) {
        console.log('[Whitelist] BLOCKED duplicate (currently processing):', msg.id);
        return true;
    }
    
    // Rate limit per user
    const userId = msg.author.id;
    const lastCmd = userRateLimits.get(userId);
    const now = Date.now();
    if (lastCmd && now - lastCmd < RATE_LIMIT_MS) {
        console.log('[Whitelist] Rate limited:', userId);
        return true;
    }
    userRateLimits.set(userId, now);
    
    // Mark as processing
    processingMessages.add(msg.id);
    console.log('[Whitelist] Processing message:', msg.id, 'Command:', content.substring(0, 50));
    
    // Cleanup old entries (TTL-based)
    for (const [id, ts] of processedMessages) {
        if (now - ts > PROCESSED_TTL_MS) processedMessages.delete(id);
        if (processedMessages.size <= MAX_PROCESSED) break;
    }
    let match;
    
    // Help
    if (CMD.help.test(content)) {
        await msg.reply(
            '**Whitelist Commands**\n' +
            '`!whitelist add <userId> <guns>` - Add user (runtime)\n' +
            '`!whitelist remove <userId> [guns]` - Remove user or guns\n' +
            '`!whitelist lookup <userId>` - Check user\'s guns\n' +
            '`!whitelist list` - Show runtime entries only\n' +
            '`!whitelist all` - Show ALL users (hardcoded + runtime)\n' +
            '`!whitelist sync` - Force sync cache\n\n' +
            '**Available Guns:** ' + VALID_GUNS.join(', ')
        );
        markProcessed(msg.id);
        return true;
    }
    
    // List runtime only
    if (CMD.list.test(content)) {
        const whitelist = await getWhitelist();
        await msg.reply('**Runtime Whitelist Entries:**\n' + formatList(whitelist));
        markProcessed(msg.id);
        return true;
    }
    
    // List ALL (hardcoded + runtime)
    if (CMD.listAll.test(content)) {
        const runtime = await getWhitelist();
        const allUsers = new Map();
        
        // Add hardcoded users
        for (const [id, data] of Object.entries(HARDCODED_USERS)) {
            allUsers.set(id, { ...data, source: 'STUDIO' });
        }
        
        // Overlay runtime users
        for (const [id, data] of Object.entries(runtime)) {
            if (allUsers.has(id)) {
                const existing = allUsers.get(id);
                const mergedGuns = [...new Set([...existing.guns, ...(data.guns || [])])];
                allUsers.set(id, { ...existing, guns: mergedGuns, source: 'BOTH' });
            } else {
                allUsers.set(id, { name: data.name || 'Unknown', guns: data.guns || [], source: 'RUNTIME' });
            }
        }
        
        const lines = [];
        for (const [id, data] of allUsers) {
            const tag = data.source === 'BOTH' ? '[BOTH]' : data.source === 'RUNTIME' ? '[RUNTIME]' : '[STUDIO]';
            lines.push(`${tag} \`${id}\` (${data.name}): ${data.guns.join(', ')}`);
        }
        
        let response = `**All Whitelisted Users (${allUsers.size} total)**\n`;
        response += `[STUDIO] = Studio | [RUNTIME] = Runtime | [BOTH] = Both\n\n`;
        
        if (lines.join('\n').length > 1800) {
            response += lines.slice(0, 40).join('\n') + `\n... and ${lines.length - 40} more`;
        } else {
            response += lines.join('\n');
        }
        
        await msg.reply(response);
        markProcessed(msg.id);
        return true;
    }
    
    // Sync
    if (CMD.sync.test(content)) {
        whitelistCache = await getWhitelist();
        await msg.reply(`Synced ${Object.keys(whitelistCache).length} runtime entries`);
        markProcessed(msg.id);
        return true;
    }
    
    // Lookup (checks both hardcoded and runtime)
    match = content.match(CMD.lookup);
    if (match) {
        const runtime = await getWhitelist();
        const userId = match[1];
        const runtimeEntry = runtime[userId];
        const hardcodedEntry = HARDCODED_USERS[parseInt(userId)];
        
        if (runtimeEntry || hardcodedEntry) {
            let guns = [];
            let sources = [];
            let name = 'Unknown';
            
            if (hardcodedEntry) {
                guns.push(...hardcodedEntry.guns);
                sources.push('Studio');
                name = hardcodedEntry.name;
            }
            if (runtimeEntry) {
                guns.push(...(runtimeEntry.guns || []));
                sources.push('Runtime');
                if (runtimeEntry.name) name = runtimeEntry.name;
            }
            
            const uniqueGuns = [...new Set(guns)];
            await msg.reply(`**User ${userId}** (${name})\nSource: ${sources.join(' + ')}\nGuns: ${uniqueGuns.join(', ')}`);
        } else {
            await msg.reply(`User \`${userId}\` is not whitelisted.`);
        }
        markProcessed(msg.id);
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
            markProcessed(msg.id);
            return true;
        }
        
        // Fetch username from Roblox API
        const username = await fetchRobloxUsername(userId);
        if (!username) {
            await msg.reply(`Invalid user ID: \`${userId}\``);
            markProcessed(msg.id);
            return true;
        }
        
        const whitelist = await getWhitelist();
        const existing = whitelist[userId]?.guns || [];
        
        // Check for duplicates
        const newGuns = guns.filter(g => !existing.includes(g));
        if (newGuns.length === 0) {
            await msg.reply(`User \`${userId}\` (${username}) already has: ${guns.join(', ')}`);
            markProcessed(msg.id);
            return true;
        }
        
        if (whitelist[userId]) {
            whitelist[userId].guns = [...existing, ...newGuns];
            whitelist[userId].name = username;
            whitelist[userId].updatedBy = msg.author.username;
            whitelist[userId].updatedAt = new Date().toISOString();
        } else {
            whitelist[userId] = {
                guns: newGuns,
                name: username,
                addedBy: msg.author.username,
                addedAt: new Date().toISOString(),
            };
        }
        
        if (await saveWhitelist(whitelist)) {
            await msg.reply(`Added \`${userId}\` (${username}) with: ${newGuns.join(', ')}\n*Live in-game now!*`);
        } else {
            await msg.reply(`Failed to update DataStore`);
        }
        markProcessed(msg.id);
        return true;
    }
    
    // Remove
    match = content.match(CMD.remove);
    if (match) {
        const userId = match[1];
        const gunInput = match[2];
        
        const whitelist = await getWhitelist();
        
        if (!whitelist[userId]) {
            await msg.reply(`User \`${userId}\` not in runtime whitelist.`);
            markProcessed(msg.id);
            return true;
        }
        
        if (gunInput) {
            const gunsToRemove = parseGuns(gunInput);
            whitelist[userId].guns = whitelist[userId].guns.filter(
                g => !gunsToRemove.includes(g)
            );
            
            if (whitelist[userId].guns.length === 0) {
                delete whitelist[userId];
                await msg.reply(`Removed \`${userId}\` entirely`);
            } else {
                await msg.reply(`Removed from \`${userId}\`: ${gunsToRemove.join(', ')}`);
            }
        } else {
            delete whitelist[userId];
            await msg.reply(`Removed \`${userId}\` from runtime whitelist`);
        }
        
        await saveWhitelist(whitelist);
        markProcessed(msg.id);
        return true;
    }
    
    markProcessed(msg.id);
    return false;
}

/**
 * Mark message as fully processed
 */
function markProcessed(msgId) {
    processingMessages.delete(msgId);
    processedMessages.set(msgId, Date.now());
}

/**
 * Initialize
 */
async function initWhitelist() {
    // Log instance ID to detect multiple instances
    const instanceId = Math.random().toString(36).substring(2, 8);
    console.log(`[Whitelist] Initializing instance: ${instanceId}`);
    
    if (!ROBLOX_UNIVERSE_ID || !ROBLOX_DATASTORE_KEY) {
        console.warn('[Whitelist] Missing ROBLOX_UNIVERSE_ID or ROBLOX_DATASTORE_KEY');
        return false;
    }
    if (!WHITELIST_CHANNEL_ID) {
        console.warn('[Whitelist] Missing WHITELIST_CHANNEL_ID');
        return false;
    }
    console.log(`[Whitelist] Channel ID: ${WHITELIST_CHANNEL_ID}`);
    console.log(`[Whitelist] Universe ID: ${ROBLOX_UNIVERSE_ID}`);
    
    try {
        whitelistCache = await getWhitelist();
        console.log(`[Whitelist] Loaded ${Object.keys(whitelistCache).length} runtime entries`);
        return true;
    } catch (e) {
        console.error('[Whitelist] Init failed:', e.message);
        return false;
    }
}

module.exports = {
    handleWhitelistCommand,
    initWhitelist,
    VALID_GUNS,
};
