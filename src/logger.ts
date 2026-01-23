/**
 * Logger utility with structured logging
 */

import { LOG_LEVEL, LogLevel, Logger } from './types';

const logLevel: LogLevel = LOG_LEVEL[
    (process.env.LOG_LEVEL?.toUpperCase() as keyof typeof LOG_LEVEL) ?? 'INFO'
] ?? LOG_LEVEL.INFO;

function formatLog(
    level: string,
    msg: string,
    meta?: Record<string, unknown>
): string {
    const ts = new Date().toISOString();
    return `[${ts}] [${level}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
}

export const log: Logger = {
    debug(msg: string, meta?: Record<string, unknown>): void {
        if (logLevel <= LOG_LEVEL.DEBUG) {
            console.log(formatLog('DEBUG', msg, meta));
        }
    },

    info(msg: string, meta?: Record<string, unknown>): void {
        if (logLevel <= LOG_LEVEL.INFO) {
            console.log(formatLog('INFO', msg, meta));
        }
    },

    warn(msg: string, meta?: Record<string, unknown>): void {
        if (logLevel <= LOG_LEVEL.WARN) {
            console.warn(formatLog('WARN', msg, meta));
        }
    },

    error(msg: string, meta?: Record<string, unknown>): void {
        console.error(formatLog('ERROR', msg, meta));
    }
};
