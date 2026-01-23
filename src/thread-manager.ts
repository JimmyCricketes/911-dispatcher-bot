/**
 * Thread Manager with LRU eviction
 */

import { Client } from 'discord.js';
import { ThreadData, ThreadStats, CLOSE_REASON, CloseReason, CallType, TOPIC, ACTION } from './types';
import { CFG } from './config';
import { log } from './logger';
import { CircuitBreaker } from './circuit-breaker';
import { ProcessedCallsTracker } from './processed-calls';

// Validation helper
const validCallId = (id: string): boolean => {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(id);
};

class LRUNode {
    key: string;
    value: ThreadData;
    prev: LRUNode | null = null;
    next: LRUNode | null = null;

    constructor(key: string, value: ThreadData) {
        this.key = key;
        this.value = value;
    }
}

export class ThreadManager {
    private readonly map: Map<string, LRUNode> = new Map();
    private readonly callIndex: Map<string, string> = new Map();
    private head: LRUNode | null = null;
    private tail: LRUNode | null = null;
    private timer: NodeJS.Timeout | null = null;
    private stats = { active: 0, answered: 0, created: 0, closed: 0 };

    private readonly client: Client;
    private readonly circuit: CircuitBreaker;
    private readonly processedCalls: ProcessedCallsTracker;
    private readonly sendToRoblox: (topic: string, data: Record<string, unknown>, correlationId: string) => Promise<{ success: boolean; error?: string }>;

    constructor(
        client: Client,
        circuit: CircuitBreaker,
        processedCalls: ProcessedCallsTracker,
        sendToRoblox: (topic: string, data: Record<string, unknown>, correlationId: string) => Promise<{ success: boolean; error?: string }>
    ) {
        this.client = client;
        this.circuit = circuit;
        this.processedCalls = processedCalls;
        this.sendToRoblox = sendToRoblox;
        this.startCleanup();
    }

    private moveToHead(node: LRUNode): void {
        if (node === this.head) return;

        if (node.prev) node.prev.next = node.next;
        else this.head = node.next;

        if (node.next) node.next.prev = node.prev;
        else this.tail = node.prev;

        node.prev = node.next = null;

        if (this.head) {
            this.head.prev = node;
            node.next = this.head;
        }
        this.head = node;
        if (!this.tail) this.tail = node;
    }

    private addToHead(node: LRUNode): void {
        node.prev = null;
        node.next = this.head;
        if (this.head) this.head.prev = node;
        this.head = node;
        if (!this.tail) this.tail = node;
    }

    private removeTail(): LRUNode | null {
        if (!this.tail) return null;
        const node = this.tail;
        if (node.prev) {
            this.tail = node.prev;
            this.tail.next = null;
        } else {
            this.head = this.tail = null;
        }
        node.prev = node.next = null;
        return node;
    }

    private removeNode(node: LRUNode): void {
        if (node.prev) node.prev.next = node.next;
        else this.head = node.next;

        if (node.next) node.next.prev = node.prev;
        else this.tail = node.prev;

        node.prev = node.next = null;
    }

    create(
        threadId: string,
        callId: string,
        callType: CallType,
        correlationId: string
    ): ThreadData | null {
        if (!validCallId(callId)) return null;

        if (this.map.size >= CFG.threads.max) {
            const evicted = this.removeTail();
            if (evicted) {
                this.map.delete(evicted.key);
                this.callIndex.delete(evicted.value.callId);
                this.stats.active--;
                if (evicted.value.answered) this.stats.answered--;
                this.stats.closed++;
                log.info('Thread evicted', {
                    threadId: evicted.key,
                    callId: evicted.value.callId,
                    reason: CLOSE_REASON.EVICTED
                });
            }
        }

        const existing = this.callIndex.get(callId);
        if (existing && this.map.has(existing)) {
            const node = this.map.get(existing)!;
            this.moveToHead(node);
            return node.value;
        }

        const data: ThreadData = {
            threadId,
            callId,
            callType,
            correlationId,
            answered: false,
            lastActivity: Date.now(),
            messages: 0,
            archived: false,
        };

        const node = new LRUNode(threadId, data);
        this.map.set(threadId, node);
        this.callIndex.set(callId, threadId);
        this.addToHead(node);
        this.stats.active++;
        this.stats.created++;

        log.info('Thread created', { threadId, callId, callType });
        return data;
    }

    get(threadId: string): ThreadData | undefined {
        const node = this.map.get(threadId);
        if (!node) return undefined;
        node.value.lastActivity = Date.now();
        this.moveToHead(node);
        return node.value;
    }

    getByCallId(callId: string): ThreadData | undefined {
        const threadId = this.callIndex.get(callId);
        return threadId ? this.get(threadId) : undefined;
    }

    hasCallId(callId: string): boolean {
        return this.callIndex.has(callId);
    }

    markAnswered(threadId: string): boolean {
        const node = this.map.get(threadId);
        if (!node) return false;
        if (!node.value.answered) {
            node.value.answered = true;
            this.stats.answered++;
        }
        node.value.lastActivity = Date.now();
        this.moveToHead(node);
        return true;
    }

    markArchived(threadId: string): void {
        const node = this.map.get(threadId);
        if (node) {
            node.value.archived = true;
            node.value.lastActivity = Date.now();
        }
    }

    recordMessage(threadId: string): void {
        const node = this.map.get(threadId);
        if (node) {
            node.value.messages++;
            node.value.lastActivity = Date.now();
            this.moveToHead(node);
        }
    }

    close(threadId: string, reason: CloseReason = CLOSE_REASON.CLOSED): ThreadData | null {
        const node = this.map.get(threadId);
        if (!node) return null;

        this.removeNode(node);
        this.map.delete(threadId);
        this.callIndex.delete(node.value.callId);
        this.stats.active--;
        if (node.value.answered) this.stats.answered--;
        this.stats.closed++;

        log.info('Thread closed', {
            threadId,
            callId: node.value.callId,
            reason
        });

        return node.value;
    }

    getStats(): ThreadStats {
        return {
            active: this.stats.active,
            answered: this.stats.answered,
            waiting: this.stats.active - this.stats.answered,
            circuit: this.circuit.getState(),
            processedCalls: this.processedCalls.size(),
            bloomFilter: {
                totalItems: this.processedCalls.getBloomStats().callIds.totalItems,
                generations: this.processedCalls.getBloomStats().callIds.generations
            }
        };
    }

    getStaleThreads(): Array<{ threadId: string } & ThreadData> {
        const now = Date.now();
        const stale: Array<{ threadId: string } & ThreadData> = [];

        let current = this.tail;
        while (current) {
            if (now - current.value.lastActivity > CFG.threads.staleMs) {
                stale.push({ ...current.value, threadId: current.key });
            }
            current = current.prev;
        }

        return stale;
    }

    private async cleanup(): Promise<void> {
        const stale = this.getStaleThreads();

        for (const data of stale) {
            if (data.answered && !data.archived) {
                await this.sendToRoblox(
                    TOPIC.ACTION,
                    {
                        callId: data.callId,
                        action: ACTION.HANGUP,
                        dispatcher: 'System'
                    },
                    data.correlationId
                );
            }

            this.close(data.threadId, CLOSE_REASON.STALE);

            try {
                const thread = await this.client.channels.fetch(data.threadId).catch(() => null);
                if (thread && 'isThread' in thread && thread.isThread() && !thread.archived) {
                    await thread.setArchived(true);
                }
            } catch (err) {
                const error = err as Error;
                log.warn('Failed to archive stale thread', {
                    threadId: data.threadId,
                    error: error.message
                });
            }
        }

        if (stale.length) {
            log.info('Cleanup complete', {
                removed: stale.length,
                remaining: this.stats.active
            });
        }
    }

    private startCleanup(): void {
        this.timer = setInterval(() => {
            this.cleanup().catch(err => {
                const error = err as Error;
                log.warn('Cleanup error', { error: error.message });
            });
        }, CFG.threads.cleanupMs);
        this.timer.unref();
    }

    destroy(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.processedCalls.destroy();
    }
}
