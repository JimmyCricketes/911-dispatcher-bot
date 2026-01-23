/**
 * Configuration module
 */

import { AppConfig } from './types';

// Environment validation
const REQUIRED_ENV = ['DISCORD_TOKEN', 'UNIVERSE_ID', 'ROBLOX_API_KEY', 'DISPATCHER_PING'] as const;

const missing = REQUIRED_ENV.filter(k => !process.env[k]?.trim());
if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
}

export const CFG: AppConfig = Object.freeze({
    dispatcher: process.env.DISPATCHER_PING!,
    adminNotify: process.env.ADMIN_NOTIFY ?? process.env.DISPATCHER_PING!,
    roblox: Object.freeze({
        universeId: process.env.UNIVERSE_ID!,
        apiKey: process.env.ROBLOX_API_KEY!,
        host: 'apis.roblox.com',
        path: '/messaging-service/v1',
        timeoutMs: 10000,
    }),
    rate: Object.freeze({ perSec: 5, retries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }),
    discord: Object.freeze({ perSec: 10, retries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }),
    circuit: Object.freeze({ threshold: 5, resetMs: 30000, maxInFlight: 50 }),
    threads: Object.freeze({ max: 100, archiveMins: 60, staleMs: 1800000, cleanupMs: 300000 }),
    limits: Object.freeze({ msgLength: 500, callIdMax: 50, threadNameMax: 100, usernameMax: 20 }),
    processedCalls: Object.freeze({ maxSize: 10000, evictCount: 1000, ttlMs: 3600000 }),
    port: parseInt(process.env.PORT ?? '3000', 10),
    shutdownGraceMs: 5000,
    cacheTtlMs: 300000,
});

// Compiled regex patterns
export const RE = Object.freeze({
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
