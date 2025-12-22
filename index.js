/**
 * 911 Dispatcher Bot v3.5 (Optimized)
 * Discord <-> Roblox emergency call bridge
 */

'use strict';

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');
const https = require('https');
const crypto = require('crypto');

// Environment validation
const REQUIRED_ENV = ['DISCORD_TOKEN', 'UNIVERSE_ID', 'ROBLOX_API_KEY', 'DISPATCHER_PING'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]?.trim());
if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
}

// Configuration
const CFG = {
    dispatcher: process.env.DISPATCHER_PING,
    adminNotify: process.env.ADMIN_NOTIFY || process.env.DISPATCHER_PING,
    roblox: {
        universeId: process.env.UNIVERSE_ID,
        apiKey: process.env.ROBLOX_API_KEY,
        host: 'apis.roblox.com',
        path: '/messaging-service/v1',
        timeoutMs: 10000,
    },
    rate: { perSec: 5, retries: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
    discord: { perSec: 10 },
    circuit: { threshold: 5, resetMs: 30000 },
    threads: { max: 100, archiveMins: 60, staleMs: 1800000, cleanupMs: 300000 },
    limits: { msgLength: 500, callIdMax: 50, threadNameMax: 100, usernameMax: 20 },
    processedCalls: { maxSize: 10000, evictCount: 1000, ttlMs: 3600000 },
    port: parseInt(process.env.PORT, 10) || 3000,
    shutdownGraceMs: 5000,
    cacheTtlMs: 300000,
};

// Compiled patterns
const RE = {
    callId: /^[A-Za-z0-9_-]{1,50}$/,
    extract: [/Call\s*ID[:\s]+([A-Za-z0-9_-]+)/i, /ID[:\s]+([A-Za-z0-9_-]+)/i],
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

// Logging
const LOG_LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const logLevel = LOG_LEVEL[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVEL.INFO;

const log = {
    fmt: (lvl, msg, meta) => `[${new Date().toISOString()}] [${lvl}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`,
    debug: (msg, meta) => logLevel <= LOG_LEVEL.DEBUG && console.log(log.fmt('DEBUG', msg, meta)),
    info: (msg, meta) => logLevel <= LOG_LEVEL.INFO && console.log(log.fmt('INFO', msg, meta)),
    warn: (msg, meta) => logLevel <= LOG_LEVEL.WARN && console.warn(log.fmt('WARN', msg, meta)),
    error: (msg, meta) => console.error(log.fmt('ERROR', msg, meta)),
};

// Utilities
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sanitize = text => (text || '').substring(0, CFG.limits.msgLength).replace(/[\x00-\x1F\x7F]/g, '').trim();
const sanitizeUsername = username => (username || 'Unknown').replace(/[^\w\s-]/g, '').substring(0, CFG.limits.usernameMax).trim() || 'Dispatcher';
const validCallId = id => typeof id === 'string' && RE.callId.test(id);
const generateCorrelationId = callId => `${callId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

// Rate Limiter
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

    success() { this.failures = 0; this.state = 'CLOSED'; }

    fail() {
        this.failures++;
        this.lastFail = Date.now();
        if (this.state === 'HALF_OPEN' || this.failures >= this.threshold) {
            this.state = 'OPEN';
            log.warn('Circuit breaker opened', { failures: this.failures });
        }
    }

    getState() { return { state: this.state, failures: this.failures }; }
}

const circuit = new CircuitBreaker(CFG.circuit.threshold, CFG.circuit.resetMs);

// Processed Calls Tracker
class ProcessedCallsTracker {
    #callIds = new Map();
    #messageIds = new Set();

    markCallId(callId, correlationId) {
        this.#callIds.set(callId, { timestamp: Date.now(), correlationId });
        this.#evict();
    }

    markMessageId(messageId) { this.#messageIds.add(messageId); }

    hasCallId(callId) {
        const entry = this.#callIds.get(callId);
        if (!entry) return false;
        if (Date.now() - entry.timestamp > CFG.processedCalls.ttlMs) {
            this.#callIds.delete(callId);
            return false;
        }
        return true;
    }

    hasMessageId(messageId) { return this.#messageIds.has(messageId); }

    #evict() {
        if (this.#callIds.size <= CFG.processedCalls.maxSize) return;

        const entries = [...this.#callIds.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, CFG.processedCalls.evictCount);

        entries.forEach(([id]) => this.#callIds.delete(id));

        if (this.#messageIds.size > CFG.processedCalls.maxSize) {
            [...this.#messageIds].slice(0, CFG.processedCalls.evictCount).forEach(id => this.#messageIds.delete(id));
        }

        log.info('Evicted old processed entries', { evicted: entries.length });
    }

    size() { return this.#callIds.size; }
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

    constructor() { this.#startCleanup(); }

    #moveToHead(node) {
        if (node === this.#head) return;
        if (node.prev) node.prev.next = node.next; else this.#head = node.next;
        if (node.next) node.next.prev = node.prev; else this.#tail = node.prev;
        node.prev = node.next = null;
        if (this.#head) { this.#head.prev = node; node.next = this.#head; }
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
        if (node.prev) { this.#tail = node.prev; this.#tail.next = null; }
        else { this.#head = this.#tail = null; }
        node.prev = node.next = null;
        return node;
    }

    #removeNode(node) {
        if (node.prev) node.prev.next = node.next; else this.#head = node.next;
        if (node.next) node.next.prev = node.prev; else this.#tail = node.prev;
        node.prev = node.next = null;
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
            threadId, callId, callType, correlationId,
            answered: false, lastActivity: Date.now(), messages: 0, archived: false,
        };
        const node = new LRUNode(threadId, data);

        this.#map.set(threadId, node);
        this.#callIndex.set(callId, threadId);
        this.#addToHead(node);
        this.#stats.active++;
        this.#stats.created++;

        log.info('Thread created', { threadId, callId, callType });
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

    hasCallId(callId) { return this.#callIndex.has(callId); }

    markAnswered(threadId) {
        const node = this.#map.get(threadId);
        if (!node) return false;
        if (!node.value.answered) { node.value.answered = true; this.#stats.answered++; }
        node.value.lastActivity = Date.now();
        this.#moveToHead(node);
        return true;
    }

    markArchived(threadId) {
        const node = this.#map.get(threadId);
        if (node) { node.value.archived = true; node.value.lastActivity = Date.now(); }
    }

    recordMessage(threadId) {
        const node = this.#map.get(threadId);
        if (node) { node.value.messages++; node.value.lastActivity = Date.now(); this.#moveToHead(node); }
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

        log.info('Thread closed', { threadId, callId: node.value.callId, reason });
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
        const now = Date.now(), stale = [];
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
                    callId: data.callId, action: 'hangup', dispatcher: 'System',
                }, data.correlationId);
            }
            this.close(data.threadId, 'stale');

            try {
                const thread = await client.channels.fetch(data.threadId).catch(() => null);
                if (thread?.isThread?.() && !thread.archived) await thread.setArchived(true);
            } catch (err) {
                log.warn('Failed to archive stale thread', { threadId: data.threadId, error: err.message });
            }
        }

        if (stale.length) log.info('Cleanup complete', { removed: stale.length, remaining: this.#stats.active });
    }

    #startCleanup() {
        this.#timer = setInterval(() => this.#cleanup().catch(err => log.warn('Cleanup error', { error: err.message })), CFG.threads.cleanupMs);
        this.#timer.unref();
    }

    destroy() { if (this.#timer) { clearInterval(this.#timer); this.#timer = null; } }
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
                    const retry = parseInt(result.headers['retry-after'], 10);
                    const waitMs = !isNaN(retry) && retry > 0 ? retry * 1000 : CFG.rate.baseDelayMs;
                    log.warn('Roblox rate limited', { retryAfter: retry, correlationId });
                    await sleep(Math.min(waitMs, CFG.rate.maxDelayMs));
                    continue;
                }

                if (result.status >= 500) throw new Error(`Server error: ${result.status}`);

                circuit.fail();
                return { success: false, error: `HTTP ${result.status}` };
            } catch (err) {
                log.warn('Roblox API failed', { topic, attempt, error: err.message, correlationId });
                if (attempt < CFG.rate.retries) {
                    await sleep(Math.min(CFG.rate.baseDelayMs * Math.pow(2, attempt - 1), CFG.rate.maxDelayMs));
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
            res.on('data', chunk => (responseData += chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: responseData }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
    });
}

// Embed parsing
function parseEmbed(embed) {
    if (!embed?.title) return null;

    const callType = embed.title.includes('911') ? '911' : embed.title.includes('311') ? '311' : null;
    if (!callType) return null;

    let callId = null, status = null, callback = 'Unknown';

    if (embed.description) {
        const match = embed.description.match(/Call\s*ID[:\s]+([A-Za-z0-9_-]+)/i);
        if (match?.[1] && validCallId(match[1])) callId = match[1];
    }

    for (const field of embed.fields || []) {
        const name = (field.name || '').toLowerCase(), value = field.value || '';

        if (!callId && (name.includes('call id') || name.includes('callid'))) {
            const match = value.match(/([A-Za-z0-9_-]+)/);
            if (match?.[1] && validCallId(match[1])) callId = match[1];
        }

        if (name.includes('status')) status = value;
        else if (name.includes('callback') || name.includes('number')) callback = sanitize(value || 'Unknown');
    }

    return { callType, callId, status, callback };
}

// Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const threads = new ThreadManager();

// Discord reconnection handling
client.on('shardDisconnect', (event, shardId) => log.warn('Discord disconnected', { shardId, code: event?.code }));
client.on('shardReconnecting', shardId => log.info('Discord reconnecting', { shardId }));
client.on('shardResume', shardId => log.info('Discord reconnected', { shardId }));
client.on('shardError', (error, shardId) => log.error('Discord shard error', { shardId, error: error.message }));

// Message handler
client.on('messageCreate', async msg => {
    if (!msg.author) return;
    try {
        if (msg.webhookId && msg.embeds?.length) await handleIncoming(msg);
        else if (!msg.author.bot && msg.content?.trim()) await handleUser(msg);
    } catch (err) {
        log.error('Handler error', { error: err.message, stack: err.stack });
    }
});

async function handleIncoming(msg) {
    if (processedCalls.hasMessageId(msg.id)) {
        log.debug('Duplicate message ignored', { messageId: msg.id });
        return;
    }
    processedCalls.markMessageId(msg.id);

    const parsed = parseEmbed(msg.embeds[0]);
    if (!parsed?.callType || !parsed.callId) {
        log.debug('Invalid embed format', { hasTitle: !!msg.embeds[0]?.title });
        return;
    }

    if (!parsed.status?.toUpperCase().includes('RINGING')) {
        log.debug('Ignoring non-ringing status', { status: parsed.status, callId: parsed.callId });
        return;
    }

    if (processedCalls.hasCallId(parsed.callId) || threads.hasCallId(parsed.callId)) {
        log.debug('Duplicate call ignored', { callId: parsed.callId });
        return;
    }

    const correlationId = generateCorrelationId(parsed.callId);
    processedCalls.markCallId(parsed.callId, correlationId);

    try {
        await discordLimiter.acquire();
        const thread = await msg.startThread({
            name: `${parsed.callType} Call - ${parsed.callId}`.substring(0, CFG.limits.threadNameMax),
            autoArchiveDuration: CFG.threads.archiveMins,
        });

        const threadData = threads.create(thread.id, parsed.callId, parsed.callType, correlationId);
        if (!threadData) { await thread.delete().catch(() => {}); return; }

        const type = parsed.callType === '911' ? 'EMERGENCY' : 'NON-EMERGENCY';
        await discordLimiter.acquire();
        await thread.send(
            `<@&${CFG.dispatcher}>\n**INCOMING ${parsed.callType} ${type} CALL**\n\nSend a message to answer.\n\`!hangup\` to end.`
        );

        log.info('Thread created on webhook message', { threadId: thread.id, callId: parsed.callId });
    } catch (err) {
        log.error('Thread creation failed', { error: err.message, callId: parsed.callId });
    }
}

async function handleUser(msg) {
    const content = msg.content.trim();
    const isThread = msg.channel.type === ChannelType.PublicThread || msg.channel.type === ChannelType.PrivateThread;

    if (isThread) {
        const data = threads.get(msg.channel.id);
        if (data) { await handleThread(msg, data, content); return; }
    }
    await handleCommand(msg, content);
}

async function handleThread(msg, data, content) {
    const { callId, answered, callType, correlationId } = data;

    if (RE.cmd.hangup.test(content)) {
        const result = await sendToRoblox('DispatcherAction', {
            callId, action: 'hangup', dispatcher: msg.author.username, threadId: msg.channel.id,
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
            callId, action: 'answer', dispatcher: msg.author.username, message: text, threadId: msg.channel.id,
        }, correlationId);

        if (result.success) {
            threads.markAnswered(msg.channel.id);
            threads.recordMessage(msg.channel.id);
            await msg.reply('Connected: Message sent to caller.');
        } else {
            await msg.reply(`Failed to connect: ${result.error}`);
        }
        return;
    }

    const result = await sendToRoblox('DispatcherMessage', {
        callId, text, dispatcher: msg.author.username, threadId: msg.channel.id,
    }, correlationId);

    if (result.success) threads.recordMessage(msg.channel.id);
    else await msg.reply(`Failed to send: ${result.error}`);
}

async function handleCommand(msg, content) {
    if (RE.cmd.status.test(content)) {
        const s = threads.getStats();
        await msg.reply(`**Bot Status**\nActive Calls: ${s.active}\nAnswered: ${s.answered}\nWaiting: ${s.waiting}\nCircuit: ${s.circuit.state}\nProcessed: ${s.processedCalls}`);
        return;
    }

    if (RE.cmd.health.test(content)) {
        const s = threads.getStats(), healthy = s.circuit.state === 'CLOSED';
        await msg.reply(`**System Health**\nStatus: ${healthy ? 'Healthy' : 'Degraded'}\nUptime: ${Math.floor(process.uptime())}s\nCircuit: ${s.circuit.state}\nIn-flight: ${inFlightRequests}`);
        return;
    }

    if (RE.cmd.help.test(content)) {
        await msg.reply('**Commands**\n`!status` - Bot status\n`!health` - System health\n`!hangup` - End call (in thread)\n`!answer <id>` - Answer manually\n`!d <id> <msg>` - Send message\n`!hangup <id>` - End specific call');
        return;
    }

    let match = content.match(RE.cmd.answer);
    if (match) {
        if (!validCallId(match[1])) { await msg.reply('Invalid call ID.'); return; }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox('DispatcherAction', { callId: match[1], action: 'answer', dispatcher: msg.author.username }, correlationId);
        await msg.reply(result.success ? 'Answer sent.' : `Failed: ${result.error}`);
        return;
    }

    match = content.match(RE.cmd.dispatch);
    if (match) {
        if (!validCallId(match[1])) { await msg.reply('Invalid call ID.'); return; }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox('DispatcherMessage', { callId: match[1], text: sanitize(match[2]), dispatcher: msg.author.username }, correlationId);
        await msg.reply(result.success ? 'Sent.' : `Failed: ${result.error}`);
        return;
    }

    match = content.match(RE.cmd.hangupId);
    if (match) {
        if (!validCallId(match[1])) { await msg.reply('Invalid call ID.'); return; }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox('DispatcherAction', { callId: match[1], action: 'hangup', dispatcher: msg.author.username }, correlationId);
        await msg.reply(result.success ? 'Call ended.' : `Failed: ${result.error}`);
    }
}

// Health server
const app = express();

app.get('/', (req, res) => res.json({
    status: 'online', uptime: Math.floor(process.uptime()), inFlight: inFlightRequests, ...threads.getStats(),
}));

app.get('/health', (req, res) => {
    const stats = threads.getStats();
    const healthy = stats.circuit.state === 'CLOSED' && inFlightRequests < 50;
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        uptime: Math.floor(process.uptime()),
        circuit: stats.circuit,
        inFlight: inFlightRequests,
        threads: { active: stats.active, answered: stats.answered },
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

    if (inFlightRequests > 0) log.warn(`Shutdown timeout, ${inFlightRequests} requests abandoned`);

    threads.destroy();
    client.destroy();
    agent.destroy();

    await sleep(500);
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => log.error('Unhandled rejection', { error: reason?.message || String(reason) }));

// Start
client.once('ready', () => log.info(`Ready as ${client.user.tag}`));
client.on('error', err => log.error('Client error', { error: err.message }));

client.login(process.env.DISCORD_TOKEN).catch(err => {
    log.error('Login failed', { error: err.message });
    process.exit(1);
});
