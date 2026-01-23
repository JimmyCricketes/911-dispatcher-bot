/**
 * 911 Dispatcher Bot v4.0
 * Discord <-> Roblox emergency call bridge
 */

'use strict';

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');
const https = require('https');
const crypto = require('crypto');

// Whitelist system
const { handleWhitelistCommand, initWhitelist } = require('./whitelist-opencloud');

// Constants
const TOPIC = Object.freeze({ ACTION: 'DispatcherAction', MESSAGE: 'DispatcherMessage' });
const ACTION = Object.freeze({ ANSWER: 'answer', HANGUP: 'hangup' });
const CALL_TYPE = Object.freeze({ EMERGENCY: '911', NON_EMERGENCY: '311' });
const CIRCUIT_STATE = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });
const CLOSE_REASON = Object.freeze({ HANGUP: 'hangup', STALE: 'stale', EVICTED: 'evicted', CLOSED: 'closed' });

// Environment validation
const REQUIRED_ENV = Object.freeze(['DISCORD_TOKEN', 'UNIVERSE_ID', 'ROBLOX_API_KEY', 'DISPATCHER_PING']);
const missing = REQUIRED_ENV.filter(k => !process.env[k]?.trim());
if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
}

// Configuration
const CFG = Object.freeze({
    dispatcher: process.env.DISPATCHER_PING,
    adminNotify: process.env.ADMIN_NOTIFY || process.env.DISPATCHER_PING,
    roblox: Object.freeze({
        universeId: process.env.UNIVERSE_ID,
        apiKey: process.env.ROBLOX_API_KEY,
        host: 'apis.roblox.com',
        path: '/messaging-service/v1',
        timeoutMs: 10000,
    }),
    rate: Object.freeze({ perSec: 5, retries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }),
    discord: Object.freeze({ perSec: 10 }),
    circuit: Object.freeze({ threshold: 5, resetMs: 30000, maxInFlight: 50 }),
    threads: Object.freeze({ max: 100, archiveMins: 60, staleMs: 1800000, cleanupMs: 300000 }),
    limits: Object.freeze({ msgLength: 500, callIdMax: 50, threadNameMax: 100, usernameMax: 20 }),
    processedCalls: Object.freeze({ maxSize: 10000, evictCount: 1000, ttlMs: 3600000 }),
    port: parseInt(process.env.PORT, 10) || 3000,
    shutdownGraceMs: 5000,
    cacheTtlMs: 300000,
});

// Compiled patterns
const RE = Object.freeze({
    callId: /^[A-Za-z0-9_-]{1,50}$/,
    callIdExtract: /([A-Za-z0-9_-]+)/,
    descriptionCallId: /Call\s*ID[:\s]+([A-Za-z0-9_-]+)/i,
    cmd: Object.freeze({
        hangup: /^!(?:hangup|end)$/i,
        hangupId: /^!(?:hangup|end)\s+(\S+)$/i,
        answer: /^!answer\s+(\S+)$/i,
        dispatch: /^!d\s+(\S+)\s+(.+)$/is,
        status: /^!status$/i,
        health: /^!health$/i,
        help: /^!help$/i,
    }),
});

// Logging
const LOG_LEVEL = Object.freeze({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 });
const logLevel = LOG_LEVEL[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVEL.INFO;

const log = {
    fmt: (lvl, msg, meta) => {
        const ts = new Date().toISOString();
        return `[${ts}] [${lvl}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
    },
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
    #threshold;
    #resetMs;
    #failures = 0;
    #lastFail = null;
    #state = CIRCUIT_STATE.CLOSED;

    constructor(threshold, resetMs) {
        this.#threshold = threshold;
        this.#resetMs = resetMs;
    }

    canRequest() {
        if (this.#state === CIRCUIT_STATE.CLOSED) return true;
        if (this.#state === CIRCUIT_STATE.OPEN && Date.now() - this.#lastFail >= this.#resetMs) {
            this.#state = CIRCUIT_STATE.HALF_OPEN;
            return true;
        }
        return this.#state === CIRCUIT_STATE.HALF_OPEN;
    }

    success() {
        this.#failures = 0;
        this.#state = CIRCUIT_STATE.CLOSED;
    }

    fail() {
        this.#failures++;
        this.#lastFail = Date.now();
        if (this.#state === CIRCUIT_STATE.HALF_OPEN || this.#failures >= this.#threshold) {
            this.#state = CIRCUIT_STATE.OPEN;
            log.warn('Circuit breaker opened', { failures: this.#failures });
        }
    }

    getState() { return { state: this.#state, failures: this.#failures }; }
}

const circuit = new CircuitBreaker(CFG.circuit.threshold, CFG.circuit.resetMs);

// Processed Calls Tracker
class ProcessedCallsTracker {
    #callIds = new Map();
    #messageIds = new Map();

    markCallId(callId, correlationId) {
        this.#callIds.set(callId, { timestamp: Date.now(), correlationId });
        this.#evict();
    }

    markMessageId(messageId) {
        this.#messageIds.set(messageId, Date.now());
    }

    hasCallId(callId) {
        const entry = this.#callIds.get(callId);
        if (!entry) return false;
        if (Date.now() - entry.timestamp > CFG.processedCalls.ttlMs) {
            this.#callIds.delete(callId);
            return false;
        }
        return true;
    }

    hasMessageId(messageId) {
        const timestamp = this.#messageIds.get(messageId);
        if (timestamp === undefined) return false;
        if (Date.now() - timestamp > CFG.processedCalls.ttlMs) {
            this.#messageIds.delete(messageId);
            return false;
        }
        return true;
    }

    #evict() {
        const now = Date.now();
        if (this.#callIds.size > CFG.processedCalls.maxSize) {
            const entries = [...this.#callIds.entries()]
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, CFG.processedCalls.evictCount);
            entries.forEach(([id]) => this.#callIds.delete(id));
        }
        if (this.#messageIds.size > CFG.processedCalls.maxSize) {
            const entries = [...this.#messageIds.entries()]
                .sort((a, b) => a[1] - b[1])
                .slice(0, CFG.processedCalls.evictCount);
            entries.forEach(([id]) => this.#messageIds.delete(id));
        }
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
                log.info('Thread evicted', { threadId: evicted.key, callId: evicted.value.callId, reason: CLOSE_REASON.EVICTED });
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
                await sendToRoblox(TOPIC.ACTION, {
                    callId: data.callId, action: ACTION.HANGUP, dispatcher: 'System',
                }, data.correlationId);
            }
            this.close(data.threadId, CLOSE_REASON.STALE);
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
                    const base = CFG.rate.baseDelayMs * Math.pow(2, attempt - 1);
                    const jitter = Math.random() * base * 0.5;
                    await sleep(Math.min(base + jitter, CFG.rate.maxDelayMs));
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
            path: CFG.roblox.path + '/universes/' + CFG.roblox.universeId + '/topics/' + topic,
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
    if (!embed) return null;
    const data = embed.toJSON?.() ?? embed;
    if (!data?.title) return null;
    const callType = data.title.includes(CALL_TYPE.EMERGENCY) ? CALL_TYPE.EMERGENCY
        : data.title.includes(CALL_TYPE.NON_EMERGENCY) ? CALL_TYPE.NON_EMERGENCY : null;
    if (!callType) return null;
    let callId = null, status = null, callback = 'Unknown';
    if (data.description) {
        const match = data.description.match(RE.descriptionCallId);
        if (match?.[1] && validCallId(match[1])) callId = match[1];
    }
    for (const field of data.fields ?? []) {
        const name = (field.name ?? '').toLowerCase(), value = field.value ?? '';
        if (!callId && (name.includes('call id') || name.includes('callid'))) {
            const match = value.match(RE.callIdExtract);
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
    if (await handleWhitelistCommand(msg)) return;
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
        if (!threadData) { await thread.delete().catch(() => { }); return; }
        const type = parsed.callType === CALL_TYPE.EMERGENCY ? 'EMERGENCY' : 'NON-EMERGENCY';
        await discordLimiter.acquire();
        await thread.send(`<@&${CFG.dispatcher}>\n**INCOMING ${parsed.callType} ${type} CALL**\n\nSend a message to answer.\n\`!hangup\` to end.`);
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
        const result = await sendToRoblox(TOPIC.ACTION, {
            callId, action: ACTION.HANGUP, dispatcher: msg.author.username, threadId: msg.channel.id,
        }, correlationId);
        if (result.success) {
            await msg.reply(`${callType} call ended.`);
            threads.close(msg.channel.id, CLOSE_REASON.HANGUP);
            await discordLimiter.acquire();
            await msg.channel.setArchived(true).catch(() => { });
        } else {
            await msg.reply(`Failed: ${result.error}`);
        }
        return;
    }
    const text = sanitize(content);
    if (!text) return;
    if (!answered) {
        const result = await sendToRoblox(TOPIC.ACTION, {
            callId, action: ACTION.ANSWER, dispatcher: msg.author.username, message: text, threadId: msg.channel.id,
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
    const result = await sendToRoblox(TOPIC.MESSAGE, {
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
        const s = threads.getStats();
        const healthy = s.circuit.state === CIRCUIT_STATE.CLOSED;
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
        const result = await sendToRoblox(TOPIC.ACTION, { callId: match[1], action: ACTION.ANSWER, dispatcher: msg.author.username }, correlationId);
        await msg.reply(result.success ? 'Answer sent.' : `Failed: ${result.error}`);
        return;
    }
    match = content.match(RE.cmd.dispatch);
    if (match) {
        if (!validCallId(match[1])) { await msg.reply('Invalid call ID.'); return; }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox(TOPIC.MESSAGE, { callId: match[1], text: sanitize(match[2]), dispatcher: msg.author.username }, correlationId);
        await msg.reply(result.success ? 'Sent.' : `Failed: ${result.error}`);
        return;
    }
    match = content.match(RE.cmd.hangupId);
    if (match) {
        if (!validCallId(match[1])) { await msg.reply('Invalid call ID.'); return; }
        const correlationId = generateCorrelationId(match[1]);
        const result = await sendToRoblox(TOPIC.ACTION, { callId: match[1], action: ACTION.HANGUP, dispatcher: msg.author.username }, correlationId);
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
    const healthy = stats.circuit.state === CIRCUIT_STATE.CLOSED && inFlightRequests < CFG.circuit.maxInFlight;
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
client.once('ready', async () => {
    log.info(`Ready as ${client.user.tag}`);
    await initWhitelist();
});

client.on('error', err => log.error('Client error', { error: err.message }));

// Debug: Check token
const token = process.env.DISCORD_TOKEN;
log.info('Token check', {
    exists: !!token,
    length: token?.length || 0,
    prefix: token?.substring(0, 20) + '...'
});

log.info('Attempting Discord login...');

// Timeout to detect hanging login
const loginTimeout = setTimeout(() => {
    log.error('Login timeout - Discord connection hanging after 30 seconds');
    log.error('This may indicate a network issue or Discord API problem');
}, 30000);

client.login(token).then(() => {
    clearTimeout(loginTimeout);
    log.info('Login promise resolved');
}).catch(err => {
    clearTimeout(loginTimeout);
    log.error('Login failed', { error: err.message, stack: err.stack });
    process.exit(1);
});
