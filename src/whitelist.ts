/**
 * Gun Whitelist Handler - Open Cloud Version (TypeScript)
 * Updates Roblox DataStore directly via Open Cloud API
 */

import https from 'https';
import crypto from 'crypto';
import { Message } from 'discord.js';
import { WhitelistData } from './types';
import { log } from './logger';
import { TimedBloomFilter } from './bloom-filter';

// Environment
const ROBLOX_UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID ?? process.env.UNIVERSE_ID ?? '';
const ROBLOX_DATASTORE_KEY = process.env.ROBLOX_DATASTORE_KEY ?? process.env.ROBLOX_API_KEY ?? '';
const WHITELIST_CHANNEL_ID = process.env.WHITELIST_CHANNEL_ID ?? '';

const DATASTORE_NAME = 'GunWhitelist';
const ENTRY_KEY = 'whitelist_v1';

// Available guns
export const VALID_GUNS = [
    '.38 SERVICE',
    '.38 SNUBNOSE',
    'COLT MONITOR',
    'M1 CARBINE',
    'M1897 SHOTGUN',
    'M1911',
    'M1921/28 POLICE',
    'M1928 TOMMY GUN',
    'M3 GREASE',
    'M3 GREASE SHORT',
    'RUGER SPEED-SIX'
] as const;

export type ValidGun = typeof VALID_GUNS[number];

// Command patterns
const CMD = {
    add: /^!whitelist\s+add\s+(\d+)\s+(.+)$/i,
    remove: /^!whitelist\s+remove\s+(\d+)(?:\s+(.+))?$/i,
    list: /^!whitelist\s+list$/i,
    listAll: /^!whitelist\s+all$/i,
    help: /^!whitelist\s+help$/i,
    lookup: /^!whitelist\s+lookup\s+(\d+)$/i,
    sync: /^!whitelist\s+sync$/i,
} as const;

// Hardcoded whitelist
const HARDCODED_USERS: Record<number, { name: string; guns: string[] }> = {
    3274640368: { name: "chuhkee_moss", guns: ["M1911", "M1928 TOMMY GUN"] },
    1465067028: { name: "vud", guns: [".38 SNUBNOSE"] },
    56548114: { name: "interstellarriptide", guns: [".38 SNUBNOSE"] },
    1834081320: { name: "makai", guns: ["M1911", ".38 SNUBNOSE"] },
    24749217: { name: "OGSnipes20", guns: [".38 SNUBNOSE", "M1911"] },
    810924509: { name: "dirtsocksguy", guns: [".38 SNUBNOSE", "M1911"] },
    1131986134: { name: "EngIishBloke", guns: [".38 SNUBNOSE", "M1911", "M1897 Shotgun"] },
    2583816107: { name: "mossmanV3", guns: ["M1911"] },
    56444111: { name: "Triggered_Guy", guns: ["M1911", "M1897 Shotgun", ".38 SNUBNOSE"] },
    317024926: { name: "Oldraelew", guns: ["M1911"] },
    2617148664: { name: "almightyzane", guns: ["M1911", ".38 SNUBNOSE"] },
    1780276456: { name: "ffjosephii", guns: [".38 SNUBNOSE"] },
    417784525: { name: "irwb", guns: [".38 SNUBNOSE"] },
    388744626: { name: "Bigsquidz", guns: ["M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN", "M1897 Shotgun"] },
    469068528: { name: "lukas24422", guns: ["M1911", ".38 SNUBNOSE", "M1897 Shotgun"] },
    1159919315: { name: "TheMeep_MeepGaming", guns: ["M1911"] },
    8797665761: { name: "NickyParisi", guns: [".38 SNUBNOSE"] },
    3433914248: { name: "elpepo_facha", guns: [".38 SNUBNOSE", "M1897 Shotgun"] },
    8909620314: { name: "BambukoRebel", guns: [".38 SNUBNOSE", "M1911", "M1897 Shotgun"] },
    1732659616: { name: "b0edser", guns: ["M1911"] },
    3597328590: { name: "Lettuce_Funky0", guns: [".38 SNUBNOSE"] },
    1424337553: { name: "ibexe_king", guns: ["M1911", "M1928 TOMMY GUN", ".38 SNUBNOSE"] },
    1417614457: { name: "L0RENZO121", guns: [".38 SNUBNOSE"] },
    1846610781: { name: "Kejiwafen", guns: [".38 SNUBNOSE", "M1911"] },
    1464679925: { name: "ioanekingpro98", guns: [".38 SNUBNOSE", "M1897 Shotgun"] },
    1830147413: { name: "Mr_Qbama", guns: ["M1911", ".38 SNUBNOSE", "M1897 Shotgun"] },
    3170949659: { name: "RonaldCMorrison", guns: ["M1911", ".38 SNUBNOSE"] },
    1351071106: { name: "gen_wrigs124", guns: [".38 SNUBNOSE"] },
    1776017244: { name: "proboxgamer2013", guns: [".38 SNUBNOSE"] },
    955487965: { name: "firekiller326", guns: [".38 SNUBNOSE"] },
    814007398: { name: "galaxyboy_10000", guns: [".38 SNUBNOSE", "M1897 Shotgun"] },
    2263443634: { name: "Ninja12361961", guns: [".38 SNUBNOSE"] },
    986511712: { name: "TheFalling_FireStar", guns: [".38 SNUBNOSE"] },
    445512125: { name: "ThiefenX", guns: [".38 SNUBNOSE"] },
    1638404386: { name: "Anarchbund", guns: [".38 SNUBNOSE"] },
    223857801: { name: "Skeletonik", guns: ["M1911"] },
    544836564: { name: "IDJLOVER_9231", guns: [".38 SNUBNOSE"] },
    27471332: { name: "Ludakres", guns: [".38 SNUBNOSE"] },
    1696974243: { name: "coop_32123", guns: [".38 SNUBNOSE", "M1911"] },
    3292035980: { name: "resoLsIorceN", guns: ["M1911"] },
    1508649283: { name: "AllAboutToday2", guns: [".38 SNUBNOSE", "M1897 Shotgun"] },
    1441492550: { name: "S1NISTERREALITY", guns: [".38 SNUBNOSE"] },
    1844464778: { name: "IStoleYourBread12121", guns: ["M1911"] },
    3587568832: { name: "Bob_CoolPlay", guns: [".38 SNUBNOSE"] },
    4419542026: { name: "VHSClassics", guns: [".38 SNUBNOSE"] },
    1637989816: { name: "UntilTheFlagStands", guns: ["M1911"] },
    218499531: { name: "GGG12893", guns: ["M1911", "M1928 TOMMY GUN"] },
    9519389212: { name: "RexkVaush", guns: ["M1911"] },
    317824065: { name: "fordshelby", guns: [".38 SNUBNOSE"] },
    113794875: { name: "Hacksaw307", guns: ["M1911", ".38 SNUBNOSE"] },
    246411829: { name: "redkillertank", guns: [".38 SNUBNOSE"] },
    3118272583: { name: "yeahmateaye", guns: [".38 SNUBNOSE"] },
    15630577: { name: "connor030904", guns: [".38 SNUBNOSE", "M1897 Shotgun", "M1928 TOMMY GUN"] },
    1361319250: { name: "Fawhausten", guns: ["M1911"] },
    5813348341: { name: "XenoZuccx", guns: [".38 SNUBNOSE", "M1911"] },
    424244958: { name: "Tezreta", guns: ["M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN", "M1897 Shotgun"] },
    1756102589: { name: "Farrell022", guns: [".38 SNUBNOSE"] },
    1851718638: { name: "OrangeBlossom", guns: ["M1897 Shotgun"] },
    866995178: { name: "HarlowlGuess", guns: ["M1911", ".38 SNUBNOSE", "M1928 TOMMY GUN"] },
    85658932: { name: "Sluger20067", guns: ["M1928 TOMMY GUN"] },
    105121893: { name: "Abyssal_deep", guns: ["M1911"] },
    89366796: { name: "IvorySturm", guns: ["M1928 TOMMY GUN"] },
    74456629: { name: "stopplayingpretend", guns: [".38 SNUBNOSE"] },
    5146105380: { name: "JibMan224", guns: [".38 SNUBNOSE"] },
    323942279: { name: "dreadedsabercut", guns: ["M1911"] },
    159862881: { name: "Nikkov_1", guns: ["M1897 Shotgun", "M1911"] },
    435924445: { name: "ammsjer", guns: ["M1911", "M1928 TOMMY GUN", "M1897 Shotgun"] },
    5224923521: { name: "Wildcard_858", guns: ["M1911"] },
    8336515931: { name: "Brolyfan98", guns: [".38 SNUBNOSE"] },
    1951308725: { name: "koyslop", guns: ["M1911"] },
    1976569166: { name: "CubeTheHoly", guns: [".38 SNUBNOSE"] },
};

// In-memory cache
let whitelistCache: WhitelistData = {};

// Bloom filter for processed messages (more efficient than Map)
const processedMessagesBloom = new TimedBloomFilter(1000, 300000, 2);
const processingMessages = new Set<string>();

// Rate limiting
const userRateLimits = new Map<string, number>();
const RATE_LIMIT_MS = 2000;

/**
 * Fetch Roblox username from user ID
 */
async function fetchRobloxUsername(userId: string): Promise<string | null> {
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
                        const json = JSON.parse(data) as { name?: string };
                        resolve(json.name ?? null);
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
 * DataStore request with retry
 */
const DS_RETRIES = 3;
const DS_BASE_DELAY_MS = 1000;

async function datastoreRequest<T>(method: string, entryKey: string, data: unknown = null): Promise<T | null> {
    for (let attempt = 1; attempt <= DS_RETRIES; attempt++) {
        try {
            return await datastoreRequestOnce<T>(method, entryKey, data);
        } catch (err) {
            const error = err as Error;
            if (attempt < DS_RETRIES) {
                const delay = DS_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
                log.warn(`DataStore retry ${attempt}/${DS_RETRIES}`, { error: error.message });
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
    return null;
}

function datastoreRequestOnce<T>(method: string, entryKey: string, data: unknown = null): Promise<T | null> {
    return new Promise((resolve, reject) => {
        const basePath = `/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
        const query = `?datastoreName=${encodeURIComponent(DATASTORE_NAME)}&entryKey=${encodeURIComponent(entryKey)}`;

        const headers: Record<string, string> = {
            'x-api-key': ROBLOX_DATASTORE_KEY,
        };

        let body: string | null = null;
        if (data) {
            body = JSON.stringify(data);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = String(Buffer.byteLength(body));
            headers['content-md5'] = crypto.createHash('md5').update(body).digest('base64');
        }

        const req = https.request({
            hostname: 'apis.roblox.com',
            path: basePath + query,
            method: method,
            headers: headers,
            timeout: 10000,
        }, res => {
            let responseData = '';
            res.on('data', (chunk: Buffer) => responseData += chunk.toString());
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(responseData ? JSON.parse(responseData) as T : null);
                    } catch {
                        resolve(null);
                    }
                } else if (res.statusCode === 404) {
                    resolve(null);
                } else if (res.statusCode === 429 || (res.statusCode && res.statusCode >= 500)) {
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

async function getWhitelist(): Promise<WhitelistData> {
    try {
        const data = await datastoreRequest<WhitelistData>('GET', ENTRY_KEY);
        return data ?? {};
    } catch (e) {
        const error = e as Error;
        log.error('Failed to get whitelist', { error: error.message });
        return {};
    }
}

async function saveWhitelist(whitelist: WhitelistData): Promise<boolean> {
    try {
        await datastoreRequest('POST', ENTRY_KEY, whitelist);
        whitelistCache = whitelist;
        return true;
    } catch (e) {
        const error = e as Error;
        log.error('Failed to save whitelist', { error: error.message });
        return false;
    }
}

function parseGuns(input: string): string[] {
    const guns: string[] = [];
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

function formatList(whitelist: WhitelistData): string {
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

export async function handleWhitelistCommand(msg: Message): Promise<boolean> {
    if (msg.channel.id !== WHITELIST_CHANNEL_ID) return false;
    if (msg.author.bot) return false;

    const content = msg.content.trim();
    if (!content.startsWith('!whitelist')) return false;

    // Use bloom filter for fast duplicate check
    if (processedMessagesBloom.mightContain(msg.id)) {
        log.debug('Blocked duplicate message', { messageId: msg.id });
        return true;
    }
    if (processingMessages.has(msg.id)) {
        log.debug('Blocked currently processing message', { messageId: msg.id });
        return true;
    }

    // Rate limit per user
    const userId = msg.author.id;
    const lastCmd = userRateLimits.get(userId);
    const now = Date.now();
    if (lastCmd && now - lastCmd < RATE_LIMIT_MS) {
        log.debug('Rate limited user', { userId });
        return true;
    }
    userRateLimits.set(userId, now);

    // Mark as processing
    processingMessages.add(msg.id);
    log.info('Processing whitelist command', { messageId: msg.id, command: content.substring(0, 50) });

    try {
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

        // Sync
        if (CMD.sync.test(content)) {
            whitelistCache = await getWhitelist();
            await msg.reply(`Synced ${Object.keys(whitelistCache).length} runtime entries`);
            markProcessed(msg.id);
            return true;
        }

        // Lookup
        let match = content.match(CMD.lookup);
        if (match) {
            const runtime = await getWhitelist();
            const lookupUserId = match[1];
            const runtimeEntry = runtime[lookupUserId];
            const hardcodedEntry = HARDCODED_USERS[parseInt(lookupUserId)];

            if (runtimeEntry || hardcodedEntry) {
                const guns: string[] = [];
                const sources: string[] = [];
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
                await msg.reply(`**User ${lookupUserId}** (${name})\nSource: ${sources.join(' + ')}\nGuns: ${uniqueGuns.join(', ')}`);
            } else {
                await msg.reply(`User \`${lookupUserId}\` is not whitelisted.`);
            }
            markProcessed(msg.id);
            return true;
        }

        // Add
        match = content.match(CMD.add);
        if (match) {
            const addUserId = match[1];
            const gunInput = match[2];
            const guns = parseGuns(gunInput);

            if (guns.length === 0) {
                await msg.reply(`No valid guns found. Available: ${VALID_GUNS.join(', ')}`);
                markProcessed(msg.id);
                return true;
            }

            const username = await fetchRobloxUsername(addUserId);
            if (!username) {
                await msg.reply(`Invalid user ID: \`${addUserId}\``);
                markProcessed(msg.id);
                return true;
            }

            const whitelist = await getWhitelist();
            const existing = whitelist[addUserId]?.guns || [];
            const newGuns = guns.filter(g => !existing.includes(g));

            if (newGuns.length === 0) {
                await msg.reply(`User \`${addUserId}\` (${username}) already has: ${guns.join(', ')}`);
                markProcessed(msg.id);
                return true;
            }

            if (whitelist[addUserId]) {
                whitelist[addUserId].guns = [...existing, ...newGuns];
                whitelist[addUserId].name = username;
                whitelist[addUserId].updatedBy = msg.author.username;
                whitelist[addUserId].updatedAt = new Date().toISOString();
            } else {
                whitelist[addUserId] = {
                    guns: newGuns,
                    name: username,
                    addedBy: msg.author.username,
                    addedAt: new Date().toISOString(),
                };
            }

            if (await saveWhitelist(whitelist)) {
                await msg.reply(`Added \`${addUserId}\` (${username}) with: ${newGuns.join(', ')}\n*Live in-game now!*`);
            } else {
                await msg.reply(`Failed to update DataStore`);
            }
            markProcessed(msg.id);
            return true;
        }

        // Remove
        match = content.match(CMD.remove);
        if (match) {
            const removeUserId = match[1];
            const gunInput = match[2];

            const whitelist = await getWhitelist();

            if (!whitelist[removeUserId]) {
                await msg.reply(`User \`${removeUserId}\` not in runtime whitelist.`);
                markProcessed(msg.id);
                return true;
            }

            if (gunInput) {
                const gunsToRemove = parseGuns(gunInput);
                whitelist[removeUserId].guns = whitelist[removeUserId].guns.filter(
                    g => !gunsToRemove.includes(g)
                );

                if (whitelist[removeUserId].guns.length === 0) {
                    delete whitelist[removeUserId];
                    await msg.reply(`Removed \`${removeUserId}\` entirely`);
                } else {
                    await msg.reply(`Removed from \`${removeUserId}\`: ${gunsToRemove.join(', ')}`);
                }
            } else {
                delete whitelist[removeUserId];
                await msg.reply(`Removed \`${removeUserId}\` from runtime whitelist`);
            }

            await saveWhitelist(whitelist);
            markProcessed(msg.id);
            return true;
        }

        markProcessed(msg.id);
        return false;
    } catch (err) {
        const error = err as Error;
        log.error('Whitelist command error', { error: error.message });
        markProcessed(msg.id);
        return false;
    }
}

function markProcessed(msgId: string): void {
    processingMessages.delete(msgId);
    processedMessagesBloom.add(msgId);
}

export async function initWhitelist(): Promise<boolean> {
    const instanceId = Math.random().toString(36).substring(2, 8);
    log.info('Whitelist initializing', { instanceId });

    if (!ROBLOX_UNIVERSE_ID || !ROBLOX_DATASTORE_KEY) {
        log.warn('Missing ROBLOX_UNIVERSE_ID or ROBLOX_DATASTORE_KEY');
        return false;
    }
    if (!WHITELIST_CHANNEL_ID) {
        log.warn('Missing WHITELIST_CHANNEL_ID');
        return false;
    }

    log.info('Whitelist config', {
        channelId: WHITELIST_CHANNEL_ID,
        universeId: ROBLOX_UNIVERSE_ID
    });

    try {
        whitelistCache = await getWhitelist();
        log.info('Whitelist loaded', { entries: Object.keys(whitelistCache).length });
        return true;
    } catch (e) {
        const error = e as Error;
        log.error('Whitelist init failed', { error: error.message });
        return false;
    }
}
