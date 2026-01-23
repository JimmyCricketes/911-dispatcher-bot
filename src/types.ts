/**
 * Type definitions for the 911 Dispatcher Bot
 */

// Types are standalone - discord.js types used inline where needed

// Environment configuration
export interface RobloxConfig {
    readonly universeId: string;
    readonly apiKey: string;
    readonly host: string;
    readonly path: string;
    readonly timeoutMs: number;
}

export interface RateConfig {
    readonly perSec: number;
    readonly retries: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
}

export interface CircuitConfig {
    readonly threshold: number;
    readonly resetMs: number;
    readonly maxInFlight: number;
}

export interface ThreadConfig {
    readonly max: number;
    readonly archiveMins: number;
    readonly staleMs: number;
    readonly cleanupMs: number;
}

export interface LimitsConfig {
    readonly msgLength: number;
    readonly callIdMax: number;
    readonly threadNameMax: number;
    readonly usernameMax: number;
}

export interface ProcessedCallsConfig {
    readonly maxSize: number;
    readonly evictCount: number;
    readonly ttlMs: number;
}

export interface AppConfig {
    readonly dispatcher: string;
    readonly adminNotify: string;
    readonly roblox: RobloxConfig;
    readonly rate: RateConfig;
    readonly discord: RateConfig;
    readonly circuit: CircuitConfig;
    readonly threads: ThreadConfig;
    readonly limits: LimitsConfig;
    readonly processedCalls: ProcessedCallsConfig;
    readonly port: number;
    readonly shutdownGraceMs: number;
    readonly cacheTtlMs: number;
}

// Call types
export const CALL_TYPE = {
    EMERGENCY: '911',
    NON_EMERGENCY: '311'
} as const;

export type CallType = typeof CALL_TYPE[keyof typeof CALL_TYPE];

// Actions
export const ACTION = {
    ANSWER: 'answer',
    HANGUP: 'hangup'
} as const;

export type Action = typeof ACTION[keyof typeof ACTION];

// Topics
export const TOPIC = {
    ACTION: 'DispatcherAction',
    MESSAGE: 'DispatcherMessage'
} as const;

export type Topic = typeof TOPIC[keyof typeof TOPIC];

// Circuit states
export const CIRCUIT_STATE = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
} as const;

export type CircuitState = typeof CIRCUIT_STATE[keyof typeof CIRCUIT_STATE];

// Close reasons
export const CLOSE_REASON = {
    HANGUP: 'hangup',
    STALE: 'stale',
    EVICTED: 'evicted',
    CLOSED: 'closed'
} as const;

export type CloseReason = typeof CLOSE_REASON[keyof typeof CLOSE_REASON];

// Thread data
export interface ThreadData {
    threadId: string;
    callId: string;
    callType: CallType;
    correlationId: string;
    answered: boolean;
    lastActivity: number;
    messages: number;
    archived: boolean;
}

// Parsed embed data
export interface ParsedEmbed {
    callType: CallType;
    callId: string | null;
    status: string | null;
    callback: string;
}

// Roblox API response
export interface RobloxResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

// Send result
export interface SendResult {
    success: boolean;
    error?: string;
}

// Circuit breaker state
export interface CircuitBreakerState {
    state: CircuitState;
    failures: number;
}

// Thread stats
export interface ThreadStats {
    active: number;
    answered: number;
    waiting: number;
    circuit: CircuitBreakerState;
    processedCalls: number;
    bloomFilter?: {
        totalItems: number;
        generations: number;
    };
}

// Log levels
export const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
} as const;

export type LogLevel = typeof LOG_LEVEL[keyof typeof LOG_LEVEL];

// Logger interface
export interface Logger {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
}

// Whitelist entry
export interface WhitelistEntry {
    guns: string[];
    name: string;
    addedBy?: string;
    addedAt?: string;
    updatedBy?: string;
    updatedAt?: string;
}

export interface WhitelistData {
    [userId: string]: WhitelistEntry;
}

// Command patterns
export interface CommandPatterns {
    readonly hangup: RegExp;
    readonly hangupId: RegExp;
    readonly answer: RegExp;
    readonly dispatch: RegExp;
    readonly status: RegExp;
    readonly health: RegExp;
    readonly help: RegExp;
}

export interface RegexPatterns {
    readonly callId: RegExp;
    readonly callIdExtract: RegExp;
    readonly descriptionCallId: RegExp;
    readonly cmd: CommandPatterns;
}
