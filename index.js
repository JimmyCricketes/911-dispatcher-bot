/**
 * 911 Dispatcher Bot v3.3 (Hardened)
 * Discord <-> Roblox emergency call bridge
 */

'use strict';

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');
const https = require('https');
const crypto = require('crypto');

// Environment validation
const REQUIRED_ENV = ['DISCORD_TOKEN', 'UNIVERSE_ID', 'ROBLOX_API_KEY', 'CHANNEL_911', 'CHANNEL_311', 'DISPATCHER_PING'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]?.trim());
if (missing.length) { console.error(`Missing env vars: ${missing.join(', ')}`); process.exit(1); }

// Configuration
const CFG = {
    channels: { '911': process.env.CHANNEL_911, '311': process.env.CHANNEL_311 },
    dispatcher: process.env.DISPATCHER_PING,
    adminNotify: process.env.ADMIN_NOTIFY || process.env.DISPATCHER_PING, // Fallback notification target
    roblox: {
        universeId: process.env.UNIVERSE_ID,
        apiKey: process.env.ROBLOX_API_KEY,
        host: 'apis.roblox.com',
        path: '/messaging-service/v1',
        timeoutMs: 10000,
    },
    rate: { perSec: 5, retries: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
    discord: { perSec: 10 }, // Discord API rate limit
    circuit: { threshold: 5, resetMs: 30000 },
    threads: { max: 100, archiveMins: 60, staleMs: 1800000, cleanupMs: 300000 },
    limits: { msgLength: 500, callIdMax: 50, threadNameMax: 100, usernameMax: 20 },
    processedCalls: { maxSize: 10000, evictCount: 1000, ttlMs: 3600000 }, // 1 hour TTL
    port: parseInt(process.env.PORT, 10) || 3000,
    shutdownGraceMs: 5000,
    cacheTtlMs: 300000,
};

// Compiled patterns
const RE = {
    callId: /^[A-Za-z0-9_-]{1,50}$/,
    extract: [/Call ID:\s*([A-Za-z0-9_-]+)/i, /ID:\s*([A-Za-z0-9_-]+)/i],
    cmd: {
        hangup: /^!(?:hangup|end)$/i,
        hangupId: /^!(?:hangup|end)\s+(\S+)$/i,
        answer: /^!answer\s+(\S+)$/i,
        dispatch: /^!d\s+(\S+)\s+(.+)$/is,
        status: /^!status$/i,
        health: /^!health$/i,
        help: /^!help$/i,
    },
};

// Logging with correlation ID support
const LOG_LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const logLevel = LOG_LEVEL[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVEL.INFO;

const log = {
    fmt: (lvl, msg, meta) => {
        const correlationId = meta?.correlationId || '';
        const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
        return `[${new Date().toISOString()}] [${lvl}]${correlationId ? ` [${correlationId}]` : ''} ${msg}${metaStr}`;
    },
    debug: (msg, meta) => logLevel <= LOG_LEVEL.DEBUG && console.log(log.fmt('DEBUG', msg, meta)),
    info: (msg, meta) => logLevel <= LOG_LEVEL.INFO && console.log(log.fmt('INFO', msg, meta)),
    warn: (msg, meta) => logLevel <= LOG_LEVEL.WARN && console.warn(log.fmt('WARN', msg, meta)),
    error: (msg, meta) => console.error(log.fmt('ERROR', msg, meta)),
};

// Utilities
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sanitize = text => (text || '').substring(0, CFG.limits.msgLength).replace(/[\x00-\x1F\x7F]/g, '').trim();
const sanitizeUsername = username => (username || 'Unknown')
    .replace(/[^\w\s-]/g, '')
    .substring(0, CFG.limits.usernameMax)
    .trim() || 'Dispatcher';
const validCallId = id => typeof id === 'string' && RE.callId.test(id);
const generateCorrelationId = (callId) => `${callId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

// Rate Limiter (Generic)
class RateLimiter {
    constructor(perSec) {
        this.tokens = perSec;
        this.max = perSec;
        this.last = Date.now();
    }

    async acquire() {
        while (true) {
            const now = Date.now();
            this.tokens = Math.min(this.max, this.tokens + ((now - this.last) / 1000) * this.max);
            this.last = now;
            if (this.tokens >= 1) { this.tokens--; return; }
            await sleep(Math.ceil(((1 - this.tokens) / this.max) * 1000));
        }
    }
}

// Circuit Breaker
class CircuitBreaker {
    constructor(threshold, resetMs) {
        this.threshold = threshold;
        this.resetMs = resetMs;
        this.failures = 0;
        this.lastFail = null;
        this.state = 'CLOSED';
    }

    canRequest() {
        if (this.state === 'CLOSED') return true;
        if (this.state === 'OPEN' && Date.now() - this.lastFail >= this.resetMs) {
            this.state = 'HALF_OPEN';
            return true;
        }
        return this.state === 'HALF_OPEN';
    }

    success() {
        this.failures = 0;
        this.state = 'CLOSED';
    }

    fail() {
        this.failures++;
        this.lastFail = Date.now();
        if (this.state === 'HALF_OPEN' || this.failures >= this.threshold) {
            this.state = 'OPEN';
            log.warn('Circuit breaker opened', { failures: this.failures });
        }
    }

    getState() {
        return { state: this.state, failures: this.failures };
    }
}

const circuit = new CircuitBreaker(CFG.circuit.threshold, CFG.circuit.resetMs);

// Processed Calls Tracker (LRU with TTL)
class ProcessedCallsTracker {
    #calls = new Map(); // callId -> { timestamp, correlationId }

    mark(callId, correlationId) {
        this.#calls.set(callId, { timestamp: Date.now(), correlationId });
        this.#evict();
    }

    has(callId) {
        const entry = this.#calls.get(callId);
        if (!entry) return false;

        // Check TTL
        if (Date.now() - entry.timestamp > CFG.processedCalls.ttlMs) {
            this.#calls.delete(callId);
            return false;
        }
        return true;
    }

    #evict() {
        if (this.#calls.size <= CFG.processedCalls.maxSize) return;

        const entries = [...this.#calls.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, CFG.processedCalls.evictCount);

        entries.forEach(([id]) => this.#calls.delete(id));
        log.info('Evicted old processed calls', { evicted: entries.length });
    }

    size() {
        return this.#calls.size;
    }
}

const processedCalls = new ProcessedCallsTracker();

// LRU Node
class LRUNode {
    constructor(key, value) {
        this.key = key;
        this.value = value;
        this.prev = null;
        this.next = null;
    }
}

// Thread Manager
class ThreadManager {
    #map = new Map();
    #callIndex = new Map();
    #head = null;
    #tail = null;
    #timer = null;
    #stats = { active: 0, answered: 0, created: 0, closed: 0 };

    constructor() {
        this.#startCleanup();
    }

    #moveToHead(node) {
        if (node === this.#head) return;

        if (node.prev) node.prev.next = node.next;
        else this.#head = node.next;

        if (node.next) node.next.prev = node.prev;
        else this.#tail = node.prev;

        node.prev = null;
        node.next = null;

        if (this.#head) {
            this.#head.prev = node;
            node.next = this.#head;
        }
        this.#head = node;
        if (!this.#tail) this.#tail = node;
    }

    #addToHead(node) {
        node.prev = null;
        node.next = this.#head;
        if (this.#head) this.#head.prev = node;
        this.#head = node;
        if (!this.#tail) this.#tail = node;
    }

    #removeTail() {
        if (!this.#tail) return null;
        const node = this.#tail;

        if (node.prev) {
            this.#tail = node.prev;
            this.#tail.next = null;
        } else {
            this.#head = null;
            this.#tail = null;
        }

        node.prev = null;
        node.next = null;

        return node;
    }

    #removeNode(node) {
        if (node.prev) node.prev.next = node.next;
        else this.#head = node.next;

        if (node.next) node.next.prev = node.prev;
        else this.#tail = node.prev;

        node.prev = null;
        node.next = null;
    }

    create(threadId, callId, callType, correlationId) {
        if (!validCallId(callId)) return null;

        if (this.#map.size >= CFG.threads.max) {
            const evicted = this.#removeTail();
            if (evicted) {
                this.#map.delete(evicted.key);
                this.#callIndex.delete(evicted.value.callId);
                this.#stats.active--;
                if (evicted.value.answered) this.#stats.answered--;
                this.#stats.closed++;
                log.info('Thread evicted (LRU)', { threadId: evicted.key, callId: evicted.value.callId });
            }
        }

        const existing = this.#callIndex.get(callId);
        if (existing && this.#map.has(existing)) {
            const node = this.#map.get(existing);
            this.#moveToHead(node);
            return node.value;
        }

        const data = {
            threadId,
            callId,
            callType,
            correlationId,
            answered: false,
            lastActivity: Date.now(),
            messages: 0,
            archived: false // Track manual archiving
        };
        const node = new LRUNode(threadId, data);

        this.#map.set(threadId, node);
        this.#callIndex.set(callId, threadId);
        this.#addToHead(node);

        this.#stats.active++;
        this.#stats.created++;
        log.info('Thread created', { threadId, callId, callType, correlationId });
        return data;
    }

    get(threadId) {
        const node = this.#map.get(threadId);
        if (!node) return undefined;
        node.value.lastActivity = Date.now();
        this.#moveToHead(node);
        return node.value;
    }

    getByCallId(callId) {
        const threadId = this.#callIndex.get(callId);
        return threadId ? this.get(threadId) : undefined;
    }

    markAnswered(threadId) {
        const node = this.#map.get(threadId);
        if (!node) return false;
        if (!node.value.answered) {
            node.value.answered = true;
            this.#stats.answered++;
        }
        node.value.lastActivity = Date.now();
        this.#moveToHead(node);
        return true;
    }

    markArchived(threadId) {
        const node = this.#map.get(threadId);
        if (node) {
            node.value.archived = true;
            node.value.lastActivity = Date.now();
        }
    }

    recordMessage(threadId) {
        const node = this.#map.get(threadId);
        if (node) {
            node.value.messages++;
            node.value.lastActivity = Date.now();
            this.#moveToHead(node);
        }
    }

    close(threadId, reason = 'closed') {
        const node = this.#map.get(threadId);
        if (!node) return null;

        this.#removeNode(node);
        this.#map.delete(threadId);
        this.#callIndex.delete(node.value.callId);

        this.#stats.active--;
        if (node.value.answered) this.#stats.answered--;
        this.#stats.closed++;

        log.info('Thread closed', { threadId, callId: node.value.callId, reason, correlationId: node.value.correlationId });
        return node.value;
    }

    getStats() {
        return {
            active: this.#stats.active,
            answered: this.#stats.answered,
            waiting: this.#stats.active - this.#stats.answered,
            circuit: circuit.getState(),
            processedCalls: processedCalls.size(),
        };
    }

    getStaleThreads() {
        const now = Date.now();
        const stale = [];
        let current = this.#tail;

        while (current) {
            if (now - current.value.lastActivity > CFG.threads.staleMs) {
                stale.push({ threadId: current.key, ...current.value });
            }
            current = current.prev;
        }

        return stale;
    }

    async #cleanup() {
        const stale = this.getStaleThreads();

        for (const data of stale) {
            if (data.answered && !data.archived) {
                await sendToRoblox('DispatcherAction', {
                    callId: data.callId,
                    action: 'hangup',
                    dispatcher: 'System'
                }, data.correlationId);
            }
            this.close(data.threadId, 'stale');

            try {
                const thread = await client.channels.fetch(data.threadId).catch(() => null);
                if (thread?.isThread?.() && !thread.archived) {
                    await thread.setArchived(true);
                }
            } catch (err) {
                log.warn('Failed to archive stale thread', { threadId: data.threadId, error: err.message });
            }
        }

        if (stale.length) {
            log.info('Cleanup complete', { removed: stale.length, remaining: this.#stats.active });
        }
    }

    #startCleanup() {
        this.#timer = setInterval(() => {
            this.#cleanup().catch(err => {
                log.warn('Cleanup error', { error: err.message });
            });
        }, CFG.threads.cleanupMs);
        this.#timer.unref();
    }

    destroy() {
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
    }
}

// Channel Cache
class ChannelCache {
    #cache = new Map();

    async get(channelId) {
        const cached = this.#cache.get(channelId);
        const now = Date.now();

        if (cached && now - cached.time < CFG.cacheTtlMs) {
            return cached.channel;
        }

        await discordLimiter.acquire();
        const channel = await client.channels.fetch(channelId).catch(() => null);

        if (channel) {
            this.#cache.set(channelId, { channel, time: now });
            return channel;
        }

        this.#cache.delete(channelId);
        return null;
    }

    invalidate(channelId) {
        this.#cache.delete(channelId);
    }

    clear() {
        this.#cache.clear();
    }
}

// Roblox API
const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const limiter = new RateLimiter(CFG.rate.perSec);
const discordLimiter = new RateLimiter(CFG.discord.perSec);

let inFlightRequests = 0;

async function sendToRoblox(topic, data, correlationId) {
    if (!circuit.canRequest()) {
        log.warn('Circuit open, rejecting request', { topic, correlationId });
        return { success: false, error: 'Circuit open - system overloaded' };
    }

    const payload = { ...data };
    if (payload.text) payload.text = sanitize(payload.text);
    if (payload.message) payload.message = sanitize(payload.message);
    if (payload.dispatcher) payload.dispatcher = sanitizeUsername(payload.dispatcher);

    inFlightRequests++;

    try {
        for (let attempt = 1; attempt <= CFG.rate.retries; attempt++) {
            try {
                await limiter.acquire();
                const result = await robloxRequest(topic, payload, correlationId);

                if (result.status >= 200 && result.status < 300) {
                    circuit.success();
                    log.debug('Roblox API success', { topic, correlationId, attempt });
                    return { success: true };
                }

                if (result.status === 429) {
                    const retryHeader = result.headers['retry-after'];
                    const retry = parseInt(retryHeader, 10);
                    const waitMs = (!isNaN(retry) && retry > 0) ? retry * 1000 : CFG.rate.baseDelayMs;
                    log.warn('Roblox rate limited', { retryAfter: retry, correlationId });
                    await sleep(Math.min(waitMs, CFG.rate.maxDelayMs));
                    continue;
                }

                if (result.status >= 500) {
                    throw new Error(`Server error: ${result.status}`);
                }

                circuit.fail();
                return { success: false, error: `HTTP ${result.status}` };
            } catch (err) {
                log.warn('Roblox API failed', { topic, attempt, error: err.message, correlationId });
                if (attempt < CFG.rate.retries) {
                    const delay = Math.min(
                        CFG.rate.baseDelayMs * Math.pow(2, attempt - 1),
                        CFG.rate.maxDelayMs
                    );
                    await sleep(delay);
                }
            }
        }

        circuit.fail();
        return { success: false, error: 'Max retries exceeded' };
    } finally {
        inFlightRequests--;
    }
}

function robloxRequest(topic, data, correlationId) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ message: JSON.stringify(data) });
        const req = https.request({
            hostname: CFG.roblox.host,
            path: `${CFG.roblox.path}/universes/${CFG.roblox.universeId}/topics/${topic}`,
            method: 'POST',
            agent,
            headers: {
                'x-api-key': CFG.roblox.apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'X-Correlation-ID': correlationId || 'unknown',
            },
            timeout: CFG.roblox.timeoutMs,
        }, res => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: responseData
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.write(body);
        req.end();
    });
}

// Embed parsing
function parseEmbed(embed) {
    if (!embed?.title) return null;

    const callType = embed.title.includes('911') ? '911' : embed.title.includes('311') ? '311' : null;
    if (!callType) return null;

    let callId = null;
    if (embed.description) {
        for (const re of RE.extract) {
            const match = embed.description.match(re);
            if (match?.[1] && validCallId(match[1])) {
                callId = match[1];
                break;
            }
        }
    }

    let status = null, callback = 'Unknown';
    for (const field of embed.fields || []) {
        const name = field.name?.toLowerCase() || '';
        if (name.includes('status')) status = field.value;
        else if (name.includes('callback') || name.includes('number')) callback = sanitize(field.value || 'Unknown');
    }

    return { callType, callId, status, callback };
}

// Admin notification fallback
async function notifyAdmin(message, meta = {}) {
    try {
        await discordLimiter.acquire();
        const user = await client.users.fetch(CFG.adminNotify).catch(() => null);
        if (user) {
            await user.send(`⚠️ **System Alert**\n${message}`).catch(() => {});
        }
    } catch (err) {
        log.error('Admin notification failed', { error: err.message, ...meta });
    }
}

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
});

const threads = new ThreadManager();
const channelCache = new ChannelCache();

// Discord reconnection handling
client.on('shardDisconnect', (event, shardId) => {
    log.warn('Discord disconnected', { shardId, code: event?.code });
});

client.on('shardReconnecting', shardId => {
    log.info('Discord reconnecting', { shardId });
    channelCache.clear();
});

client.on('shardResume', shardId => {
    log.info('Discord reconnected', { shardId });
});

client.on('shardError', (error, shardId) => {
    log.error('Discord shard error', { shardId, error: error.message });
});

// Message handler
client.on('messageCreate', async msg => {
    if (!msg.author) return;

    try {
        if (msg.author.bot && msg.embeds?.length) {
            await handleIncoming(msg);
        } else if (!msg.author.bot && msg.content?.trim()) {
            await handleUser(msg);
        }
    } catch (err) {
        log.error('Handler error', { error: err.message, stack: err.stack });
    }
});

async function handleIncoming(msg) {
    const parsed = parseEmbed(msg.embeds[0]);
    if (!parsed?.callType || !parsed.callId) return;
    if (!parsed.status?.toUpperCase().includes('RINGING')) return;

    // Prevent duplicate processing
    if (processedCalls.has(parsed.callId)) {
        log.debug('Duplicate call ignored', { callId: parsed.callId });
        return;
    }

    const correlationId = generateCorrelationId(parsed.callId);
    processedCalls.mark(parsed.callId, correlationId);

    const channelId = CFG.channels[parsed.callType];
    if (!channelId) return;

    try {
        const channel = await channelCache.get(channelId);
        if (!channel) {
            log.error('Channel fetch failed', { channelId, callId: parsed.callId, correlationId });
            await notifyAdmin(
                `Channel ${channelId} unreachable for ${parsed.callType} call ${parsed.callId}`,
                { correlationId }
            );
            return;
        }

        await discordLimiter.acquire();
        const routed = await channel.send({ embeds: msg.embeds });
        const name = `${parsed.callType} Call - ${parsed.callId}`.substring(0, CFG.limits.threadNameMax);

        let thread;
        try {
            await discordLimiter.acquire();
            thread = await routed.startThread({ name, autoArchiveDuration: CFG.threads.archiveMins });
        } catch (threadErr) {
            await routed.delete().catch(() => {});
            throw threadErr;
        }

        const threadData = threads.create(thread.id, parsed.callId, parsed.callType, correlationId);
        if (!threadData) {
            await thread.delete().catch(() => {});
            await routed.delete().catch(() => {});
            return;
        }

        const type = parsed.callType === '911' ? 'EMERGENCY' : 'NON-EMERGENCY';
        await discordLimiter.acquire();
        await thread.send(
            `<@${CFG.dispatcher}>\n` +
            `**INCOMING ${parsed.callType} ${type} CALL**\n` +
            `Callback: ${parsed.callback}\n` +
            `Call ID: \`${parsed.callId}\`\n` +
            `Correlation: \`${correlationId}\`\n\n` +
            `Send a message to answer.\n` +
            `\`!hangup\` to end.`
        );

        log.info('Thread created', { threadId: thread.id, callId: parsed.callId, correlationId });
    } catch (err) {
        log.error('Thread creation failed', { error: err.message, callId: parsed.callId, correlationId });

        const channel = await channelCache.get(channelId);
        if (channel) {
            await discordLimiter.acquire();
            await channel.send(
                `<@${CFG.dispatcher}> INCOMING ${parsed.callType} CALL\n` +
                `Call ID: \`${parsed.callId}\`\n` +
                `Use \`!answer ${parsed.callId}\` to connect.`
            ).catch(() => {});
        }
    }
}

async function handleUser(msg) {
    const content = msg.content.trim();
    const isThread = msg.channel.type === ChannelType.PublicThread ||
                     msg.channel.type === ChannelType.PrivateThread;

    if (isThread) {
        const data = threads.get(msg.channel.id);
        if (data) {
            await handleThread(msg, data, content);
            return;
        }
    }

    await handleCommand(msg, content);
}

async function handleThread(msg, data, content) {
    const { callId, answered, callType, correlationId } = data;

    if (RE.cmd.hangup.test(content)) {
        const result = await sendToRoblox('DispatcherAction', {
            callId,
            action: 'hangup',
            dispatcher: msg.author.username,
            threadId: msg.channel.id,
        }, correlationId);

        if (result.success) {
            await msg.reply(`${callType} call ended.`);
            threads.close(msg.channel.id, 'hangup');
            await discordLimiter.acquire();
            await msg.channel.setArchived(true).catch(() => {});
        } else {
            await msg.reply(`Failed: ${result.error}`);
        }
        return;
    }

    const text = sanitize(content);
    if (!text) return;

    if (!answered) {
        const result = await sendToRoblox('DispatcherAction', {
            callId,
            action: 'answer',
            dispatcher: msg.author.username,
            message: text,
            threadId: msg.channel.id,
        }, correlationId);

        if (result.success) {
            threads.markAnswered(msg.channel.id);
            threads.recordMessage(msg.channel.id);
        } else {
            await msg.reply(`Failed to connect: ${result.error}`);
        }
        return;
    }

    const result = await sendToRoblox('DispatcherMessage', {
        callId,
        text,
        dispatcher: msg.author.username,
        threadId: msg.channel.id,
    }, correlationId);

    if (result.success) {
        threads.recordMessage(msg.channel.id);
    }
}

async function handleCommand(msg, content) {
    if (RE.cmd.status.test(content)) {
        const stats = threads.getStats();
        await msg.reply(
            `Bot Online\n` +
            `Active: ${stats.active}\n` +
            `Answered: ${stats.answered}\n` +
            `Waiting: ${stats.waiting}\n` +
            `Circuit: ${stats.circuit.state}\n` +
            `Processed: ${stats.processedCalls}`
        );
        return;
    }

    if (RE.cmd.health.test(content)) {
        const stats = threads.getStats();
        const healthy = stats.circuit.state === 'CLOSED';
        await msg.reply(
            `**System Health**\n` +
            `Status: ${healthy ? '✅ Healthy' : '⚠️ Degraded'}\n` +
            `Uptime: ${Math.floor(process.uptime())}s\n` +
            `Circuit: ${stats.circuit.state}\n` +
            `In-flight: ${inFlightRequests}`
        );
        return;
    }

    if (RE.cmd.help.test(content)) {
        await msg.reply(
            '**Commands**\n' +
            '`!status` - Bot status\n' +
            '`!health` - System health\n' +
            '`!hangup` - End call (in thread)\n' +
            '`!answer <id>` - Answer manually\n' +
            '`!d <id> <msg>` - Send message\n' +
            '`!hangup <id>` - End specific call'
        );
        return;
    }

    let match = content.match(RE.cmd.answer);
    if (match) {
        if (!validCallId(match[1])) {
            await msg.reply('Invalid call ID.');
            return;
        }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox('DispatcherAction', {
            callId: match[1],
            action: 'answer',
            dispatcher: msg.author.username
        }, correlationId);
        await msg.reply(result.success ? 'Answer sent.' : `Failed: ${result.error}`);
        return;
    }

    match = content.match(RE.cmd.dispatch);
    if (match) {
        if (!validCallId(match[1])) {
            await msg.reply('Invalid call ID.');
            return;
        }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox('DispatcherMessage', {
            callId: match[1],
            text: sanitize(match[2]),
            dispatcher: msg.author.username
        }, correlationId);
        await msg.reply(result.success ? 'Sent.' : `Failed: ${result.error}`);
        return;
    }

    match = content.match(RE.cmd.hangupId);
    if (match) {
        if (!validCallId(match[1])) {
            await msg.reply('Invalid call ID.');
            return;
        }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox('DispatcherAction', {
            callId: match[1],
            action: 'hangup',
            dispatcher: msg.author.username
        }, correlationId);
        await msg.reply(result.success ? 'Call ended.' : `Failed: ${result.error}`);
    }
}

// Health server
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        uptime: Math.floor(process.uptime()),
        inFlight: inFlightRequests,
        ...threads.getStats()
    });
});

app.get('/health', (req, res) => {
    const stats = threads.getStats();
    const healthy = stats.circuit.state === 'CLOSED' && inFlightRequests < 50;
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        uptime: Math.floor(process.uptime()),
        circuit: stats.circuit,
        inFlight: inFlightRequests,
        threads: {
            active: stats.active,
            answered: stats.answered,
        },
    });
});

const server = app.listen(CFG.port, () => log.info(`Server on port ${CFG.port}`));

// Graceful shutdown
let stopping = false;

async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received, shutting down`);

    server.close();

    const deadline = Date.now() + CFG.shutdownGraceMs;
    while (inFlightRequests > 0 && Date.now() < deadline) {
        log.info(`Waiting for ${inFlightRequests} in-flight requests`);
        await sleep(500);
    }

    if (inFlightRequests > 0) {
        log.warn(`Shutdown timeout, ${inFlightRequests} requests abandoned`);
    }

    threads.destroy();
    client.destroy();
    agent.destroy();

    await sleep(500);
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => {
    log.error('Unhandled rejection', { error: reason?.message || String(reason) });
});

// Start
client.once('ready', () => log.info(`Ready as ${client.user.tag}`));
client.on('error', err => log.error('Client error', { error: err.message }));

client.login(process.env.DISCORD_TOKEN).catch(err => {
    log.error('Login failed', { error: err.message });
    process.exit(1);
});
