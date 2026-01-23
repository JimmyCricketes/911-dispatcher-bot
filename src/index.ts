/**
 * 911 Dispatcher Bot v4.0 (TypeScript)
 * Discord <-> Roblox emergency call bridge
 */

import { Client, GatewayIntentBits, ChannelType, Message } from 'discord.js';
import express, { Request, Response } from 'express';
import crypto from 'crypto';
import dns from 'dns';

// Force IPv4 to avoid IPv6 connection issues on some hosts
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

import {
    TOPIC, ACTION, CALL_TYPE, CIRCUIT_STATE, CLOSE_REASON,
    CallType, ParsedEmbed
} from './types';
import { CFG, RE } from './config';
import { log } from './logger';
import { RateLimiter } from './rate-limiter';
import { CircuitBreaker } from './circuit-breaker';
import { ProcessedCallsTracker } from './processed-calls';
import { ThreadManager } from './thread-manager';
import { sendToRoblox, getInFlightRequests, destroyAgent } from './roblox-api';
import { handleWhitelistCommand, initWhitelist } from './whitelist';

// Helper functions
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const sanitize = (text: string): string =>
    // eslint-disable-next-line no-control-regex
    (text || '').substring(0, CFG.limits.msgLength).replace(/[\x00-\x1F\x7F]/g, '').trim();
const validCallId = (id: string): boolean => typeof id === 'string' && RE.callId.test(id);
const generateCorrelationId = (callId: string): string =>
    `${callId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

// Circuit breaker and rate limiter
const circuit = new CircuitBreaker(CFG.circuit.threshold, CFG.circuit.resetMs);
const discordLimiter = new RateLimiter(CFG.discord.perSec);

// Processed calls tracker with bloom filter
const processedCalls = new ProcessedCallsTracker();

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
});

// Bound send function for thread manager
const boundSendToRoblox = (
    topic: string,
    data: Record<string, unknown>,
    correlationId: string
) => sendToRoblox(circuit, topic, data, correlationId);

// Thread manager
const threads = new ThreadManager(client, circuit, processedCalls, boundSendToRoblox);

// Embed parsing - interface for embed data
interface EmbedField {
    name?: string;
    value?: string;
}

interface EmbedLike {
    title?: string;
    description?: string;
    fields?: EmbedField[];
}

function parseEmbed(embed: unknown): ParsedEmbed | null {
    if (!embed) return null;
    const data = embed as EmbedLike;
    if (!data?.title) return null;

    const title = data.title;
    const callType: CallType | null =
        title.includes(CALL_TYPE.EMERGENCY) ? CALL_TYPE.EMERGENCY :
            title.includes(CALL_TYPE.NON_EMERGENCY) ? CALL_TYPE.NON_EMERGENCY :
                null;

    if (!callType) return null;

    let callId: string | null = null;
    let status: string | null = null;
    let callback = 'Unknown';

    const description = data.description;
    if (description) {
        const match = description.match(RE.descriptionCallId);
        if (match?.[1] && validCallId(match[1])) callId = match[1];
    }

    for (const field of data.fields ?? []) {
        const name = (field.name ?? '').toLowerCase();
        const value = String(field.value ?? '');

        if (!callId && (name.includes('call id') || name.includes('callid'))) {
            const match = value.match(RE.callIdExtract);
            if (match?.[1] && validCallId(match[1])) callId = match[1];
        }
        if (name.includes('status')) status = value;
        else if (name.includes('callback') || name.includes('number')) {
            callback = sanitize(value || 'Unknown');
        }
    }

    return { callType, callId, status, callback };
}

// Discord event handlers
client.on('shardDisconnect', (event: { code: number } | null, shardId: number) =>
    log.warn('Discord disconnected', { shardId, code: event?.code }));
client.on('shardReconnecting', (shardId: number) =>
    log.info('Discord reconnecting', { shardId }));
client.on('shardResume', (shardId: number) =>
    log.info('Discord reconnected', { shardId }));
client.on('shardError', (error: Error, shardId: number) =>
    log.error('Discord shard error', { shardId, error: error.message }));

// Message handler
client.on('messageCreate', (msg: Message) => {
    void (async () => {
        if (!msg.author) return;
        if (await handleWhitelistCommand(msg)) return;

        try {
            if (msg.webhookId && msg.embeds?.length) {
                await handleIncoming(msg);
            } else if (!msg.author.bot && msg.content?.trim()) {
                await handleUser(msg);
            }
        } catch (err) {
            const error = err as Error;
            log.error('Handler error', { error: error.message, stack: error.stack });
        }
    })();
});

async function handleIncoming(msg: Message): Promise<void> {
    if (processedCalls.hasMessageId(msg.id)) {
        log.debug('Duplicate message ignored', { messageId: msg.id });
        return;
    }
    processedCalls.markMessageId(msg.id);

    const embedData = msg.embeds[0]?.toJSON() ?? null;
    const parsed = parseEmbed(embedData);

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
            autoArchiveDuration: CFG.threads.archiveMins as 60 | 1440 | 4320 | 10080,
        });

        const threadData = threads.create(thread.id, parsed.callId, parsed.callType, correlationId);
        if (!threadData) {
            await thread.delete().catch(() => { });
            return;
        }

        const type = parsed.callType === CALL_TYPE.EMERGENCY ? 'EMERGENCY' : 'NON-EMERGENCY';
        await discordLimiter.acquire();
        await thread.send(
            `<@&${CFG.dispatcher}>\n**INCOMING ${parsed.callType} ${type} CALL**\n\n` +
            `Send a message to answer.\n\`!hangup\` to end.`
        );

        log.info('Thread created on webhook message', { threadId: thread.id, callId: parsed.callId });
    } catch (err) {
        const error = err as Error;
        log.error('Thread creation failed', { error: error.message, callId: parsed.callId });
    }
}

async function handleUser(msg: Message): Promise<void> {
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

async function handleThread(
    msg: Message,
    data: { callId: string; answered: boolean; callType: CallType; correlationId: string },
    content: string
): Promise<void> {
    const { callId, answered, callType, correlationId } = data;

    if (RE.cmd.hangup.test(content)) {
        const result = await boundSendToRoblox(TOPIC.ACTION, {
            callId,
            action: ACTION.HANGUP,
            dispatcher: msg.author.username,
            threadId: msg.channel.id,
        }, correlationId);

        if (result.success) {
            await msg.reply(`${callType} call ended.`);
            threads.close(msg.channel.id, CLOSE_REASON.HANGUP);
            await discordLimiter.acquire();
            if ('setArchived' in msg.channel) {
                await msg.channel.setArchived(true).catch(() => { });
            }
        } else {
            await msg.reply(`Failed: ${result.error}`);
        }
        return;
    }

    const text = sanitize(content);
    if (!text) return;

    if (!answered) {
        const result = await boundSendToRoblox(TOPIC.ACTION, {
            callId,
            action: ACTION.ANSWER,
            dispatcher: msg.author.username,
            message: text,
            threadId: msg.channel.id,
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

    const result = await boundSendToRoblox(TOPIC.MESSAGE, {
        callId,
        text,
        dispatcher: msg.author.username,
        threadId: msg.channel.id,
    }, correlationId);

    if (result.success) {
        threads.recordMessage(msg.channel.id);
    } else {
        await msg.reply(`Failed to send: ${result.error}`);
    }
}

async function handleCommand(msg: Message, content: string): Promise<void> {
    if (RE.cmd.status.test(content)) {
        const s = threads.getStats();
        await msg.reply(
            `**Bot Status**\n` +
            `Active Calls: ${s.active}\n` +
            `Answered: ${s.answered}\n` +
            `Waiting: ${s.waiting}\n` +
            `Circuit: ${s.circuit.state}\n` +
            `Processed: ${s.processedCalls}\n` +
            `Bloom Filter: ${s.bloomFilter?.totalItems ?? 0} items`
        );
        return;
    }

    if (RE.cmd.health.test(content)) {
        const s = threads.getStats();
        const healthy = s.circuit.state === CIRCUIT_STATE.CLOSED;
        await msg.reply(
            `**System Health**\n` +
            `Status: ${healthy ? 'Healthy' : 'Degraded'}\n` +
            `Uptime: ${Math.floor(process.uptime())}s\n` +
            `Circuit: ${s.circuit.state}\n` +
            `In-flight: ${getInFlightRequests()}`
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
        const result = await boundSendToRoblox(TOPIC.ACTION, {
            callId: match[1],
            action: ACTION.ANSWER,
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
        const result = await boundSendToRoblox(TOPIC.MESSAGE, {
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
        const result = await boundSendToRoblox(TOPIC.ACTION, {
            callId: match[1],
            action: ACTION.HANGUP,
            dispatcher: msg.author.username
        }, correlationId);
        await msg.reply(result.success ? 'Call ended.' : `Failed: ${result.error}`);
    }
}

// Health server
const app = express();

app.get('/', (_req: Request, res: Response) => {
    res.json({
        status: 'online',
        uptime: Math.floor(process.uptime()),
        inFlight: getInFlightRequests(),
        ...threads.getStats(),
    });
});

app.get('/health', (_req: Request, res: Response) => {
    const stats = threads.getStats();
    const healthy = stats.circuit.state === CIRCUIT_STATE.CLOSED &&
        getInFlightRequests() < CFG.circuit.maxInFlight;

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        uptime: Math.floor(process.uptime()),
        circuit: stats.circuit,
        inFlight: getInFlightRequests(),
        threads: { active: stats.active, answered: stats.answered },
        bloomFilter: stats.bloomFilter,
    });
});

const server = app.listen(CFG.port, () => log.info(`Server on port ${CFG.port}`));

// Graceful shutdown
let stopping = false;

async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;

    log.info(`${signal} received, shutting down`);
    server.close();

    const deadline = Date.now() + CFG.shutdownGraceMs;
    while (getInFlightRequests() > 0 && Date.now() < deadline) {
        log.info(`Waiting for ${getInFlightRequests()} in-flight requests`);
        await sleep(500);
    }

    if (getInFlightRequests() > 0) {
        log.warn(`Shutdown timeout, ${getInFlightRequests()} requests abandoned`);
    }

    threads.destroy();
    void client.destroy();
    destroyAgent();

    await sleep(500);
    process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason: unknown) => {
    const error = reason as Error;
    log.error('Unhandled rejection', { error: error?.message ?? String(reason) });
});

// Start
client.once('ready', () => {
    log.info(`Ready as ${client.user?.tag}`);
    void initWhitelist();
});

client.on('debug', (info: string) => log.debug('Discord Debug', { info }));
client.on('warn', (info: string) => log.warn('Discord Warning', { info }));
client.on('error', (err: Error) => log.error('Client error', { error: err.message }));

// Debug: Check token
const token = process.env.DISCORD_TOKEN;
log.info('Token check', {
    exists: !!token,
    length: token?.length ?? 0,
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
}).catch((err: Error) => {
    clearTimeout(loginTimeout);
    log.error('Login failed', { error: err.message, stack: err.stack });
    process.exit(1);
});
