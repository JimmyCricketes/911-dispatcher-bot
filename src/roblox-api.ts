/**
 * Roblox API client
 */

import https from 'https';
import { CFG } from './config';
import { log } from './logger';
import { RateLimiter } from './rate-limiter';
import { CircuitBreaker } from './circuit-breaker';
import { RobloxResponse, SendResult } from './types';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// Sanitization helpers
const sanitize = (text: string): string =>
    // eslint-disable-next-line no-control-regex
    (text || '').substring(0, CFG.limits.msgLength).replace(/[\x00-\x1F\x7F]/g, '').trim();

const sanitizeUsername = (username: string): string =>
    (username || 'Unknown').replace(/[^\w\s-]/g, '').substring(0, CFG.limits.usernameMax).trim() || 'Dispatcher';

// HTTPS agent for connection pooling
const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Rate limiter
const limiter = new RateLimiter(CFG.rate.perSec);

// In-flight request tracking
let inFlightRequests = 0;

export function getInFlightRequests(): number {
    return inFlightRequests;
}

function robloxRequest(
    topic: string,
    data: Record<string, unknown>,
    correlationId: string
): Promise<RobloxResponse> {
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
                'X-Correlation-ID': correlationId ?? 'unknown',
            },
            timeout: CFG.roblox.timeoutMs,
        }, res => {
            let responseData = '';
            res.on('data', (chunk: Buffer) => (responseData += chunk.toString()));
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                headers: res.headers as Record<string, string>,
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

export async function sendToRoblox(
    circuit: CircuitBreaker,
    topic: string,
    data: Record<string, unknown>,
    correlationId: string
): Promise<SendResult> {
    if (!circuit.canRequest()) {
        log.warn('Circuit open, rejecting request', { topic, correlationId });
        return { success: false, error: 'Circuit open - system overloaded' };
    }

    const payload = { ...data };
    if (typeof payload.text === 'string') payload.text = sanitize(payload.text);
    if (typeof payload.message === 'string') payload.message = sanitize(payload.message);
    if (typeof payload.dispatcher === 'string') payload.dispatcher = sanitizeUsername(payload.dispatcher);

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
                    const retryAfter = parseInt(result.headers['retry-after'] ?? '', 10);
                    const waitMs = !isNaN(retryAfter) && retryAfter > 0
                        ? retryAfter * 1000
                        : CFG.rate.baseDelayMs;
                    log.warn('Roblox rate limited', { retryAfter, correlationId });
                    await sleep(Math.min(waitMs, CFG.rate.maxDelayMs));
                    continue;
                }

                if (result.status >= 500) {
                    throw new Error(`Server error: ${result.status}`);
                }

                circuit.fail();
                return { success: false, error: `HTTP ${result.status}` };

            } catch (err) {
                const error = err as Error;
                log.warn('Roblox API failed', {
                    topic,
                    attempt,
                    error: error.message,
                    correlationId
                });

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

export function destroyAgent(): void {
    agent.destroy();
}
