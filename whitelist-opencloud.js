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

const ROBLOX_UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID || process.env.UNIVERSE_ID;
const ROBLOX_DATASTORE_KEY = process.env.ROBLOX_DATASTORE_KEY;
const WHITELIST_CHANNEL_ID = process.env.WHITELIST_CHANNEL_ID;

const DATASTORE_NAME = 'GunWhitelist';
const ENTRY_KEY = 'whitelist_v1';

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

/**
 * Make Open Cloud DataStore request
 */
function datastoreRequest(method, entryKey, data = null) {
    return new Promise((resolve, reject) => {
        const basePath = `/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
        const query = `?datastoreName=${encodeURIComponent(DATASTORE_NAME)}&entryKey=${encodeURIComponent(entryKey)}`;
        
        const options = {
            hostname: 'apis.roblox.com',
            path: basePath + query,
            method: method,
            headers: {
                'x-api-key': ROBLOX_DATASTORE_KEY,
                'Content-Type': 'application/json',
            },
        };

        if (data) {
            const body = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }

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
                } else {
                    reject(new Error(`DataStore error: ${res.statusCode} - ${responseData}`));
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
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
    if (msg.channel.id !== WHITELIST_CHANNEL_ID) return false;
    if (msg.author.bot) return false;
    
    const content = msg.content.trim();
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
        return true;
    }
    
    // List runtime only
    if (CMD.list.test(content)) {
        const whitelist = await getWhitelist();
        await msg.reply('**Runtime Whitelist Entries:**\n' + formatList(whitelist));
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
            const tag = data.source === 'BOTH' ? '' : data.source === 'RUNTIME' ? '' : '';
            lines.push(`${tag} \`${id}\` (${data.name}): ${data.guns.join(', ')}`);
        }
        
        let response = `**All Whitelisted Users (${allUsers.size} total)**\n`;
        response += `= Studio |  = Runtime | = Both\n\n`;
        
        if (lines.join('\n').length > 1800) {
            response += lines.slice(0, 40).join('\n') + `\n... and ${lines.length - 40} more`;
        } else {
            response += lines.join('\n');
        }
        
        await msg.reply(response);
        return true;
    }
    
    // Sync
    if (CMD.sync.test(content)) {
        whitelistCache = await getWhitelist();
        await msg.reply(`Synced ${Object.keys(whitelistCache).length} runtime entries`);
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
        
        const whitelist = await getWhitelist();
        
        if (whitelist[userId]) {
            const existing = whitelist[userId].guns || [];
            whitelist[userId].guns = [...new Set([...existing, ...guns])];
            whitelist[userId].updatedBy = msg.author.username;
            whitelist[userId].updatedAt = new Date().toISOString();
        } else {
            whitelist[userId] = {
                guns,
                name: null,
                addedBy: msg.author.username,
                addedAt: new Date().toISOString(),
            };
        }
        
        if (await saveWhitelist(whitelist)) {
            await msg.reply(`Added \`${userId}\` with: ${guns.join(', ')}\n*Live in-game now!*`);
        } else {
            await msg.reply(`Failed to update DataStore`);
        }
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
        return true;
    }
    
    return false;
}

/**
 * Initialize
 */
async function initWhitelist() {
    if (!ROBLOX_UNIVERSE_ID || !ROBLOX_DATASTORE_KEY) {
        console.warn('[Whitelist] Missing ROBLOX_UNIVERSE_ID or ROBLOX_DATASTORE_KEY');
        return false;
    }
    if (!WHITELIST_CHANNEL_ID) {
        console.warn('[Whitelist] Missing WHITELIST_CHANNEL_ID');
        return false;
    }
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
