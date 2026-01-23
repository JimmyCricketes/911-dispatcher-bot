/**
 * Processed Calls Tracker with Bloom Filter optimization
 * Uses bloom filter for fast duplicate detection with Map fallback for accuracy
 */

import { TimedBloomFilter } from './bloom-filter';
import { CFG } from './config';

interface CallEntry {
    timestamp: number;
    correlationId: string;
}

export class ProcessedCallsTracker {
    private readonly callIds: Map<string, CallEntry> = new Map();
    private readonly messageIds: Map<string, number> = new Map();

    // Bloom filters for fast preliminary checks
    private readonly callIdBloom: TimedBloomFilter;
    private readonly messageIdBloom: TimedBloomFilter;

    constructor() {
        // Initialize bloom filters with expected capacity and TTL matching config
        this.callIdBloom = new TimedBloomFilter(
            CFG.processedCalls.maxSize,
            CFG.processedCalls.ttlMs / 2, // Rotate at half TTL
            2 // Keep 2 generations
        );
        this.messageIdBloom = new TimedBloomFilter(
            CFG.processedCalls.maxSize,
            CFG.processedCalls.ttlMs / 2,
            2
        );
    }

    markCallId(callId: string, correlationId: string): void {
        this.callIdBloom.add(callId);
        this.callIds.set(callId, { timestamp: Date.now(), correlationId });
        this.evict();
    }

    markMessageId(messageId: string): void {
        this.messageIdBloom.add(messageId);
        this.messageIds.set(messageId, Date.now());
    }

    hasCallId(callId: string): boolean {
        // Fast path: bloom filter says definitely not present
        if (!this.callIdBloom.mightContain(callId)) {
            return false;
        }

        // Slow path: verify in map (to handle potential false positives)
        const entry = this.callIds.get(callId);
        if (!entry) {
            return false;
        }

        if (Date.now() - entry.timestamp > CFG.processedCalls.ttlMs) {
            this.callIds.delete(callId);
            return false;
        }

        return true;
    }

    hasMessageId(messageId: string): boolean {
        // Fast path: bloom filter says definitely not present
        if (!this.messageIdBloom.mightContain(messageId)) {
            return false;
        }

        // Slow path: verify in map
        const timestamp = this.messageIds.get(messageId);
        if (timestamp === undefined) {
            return false;
        }

        if (Date.now() - timestamp > CFG.processedCalls.ttlMs) {
            this.messageIds.delete(messageId);
            return false;
        }

        return true;
    }

    private evict(): void {

        // Evict old call IDs
        if (this.callIds.size > CFG.processedCalls.maxSize) {
            const entries = [...this.callIds.entries()]
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, CFG.processedCalls.evictCount);
            entries.forEach(([id]) => this.callIds.delete(id));
        }

        // Evict old message IDs
        if (this.messageIds.size > CFG.processedCalls.maxSize) {
            const entries = [...this.messageIds.entries()]
                .sort((a, b) => a[1] - b[1])
                .slice(0, CFG.processedCalls.evictCount);
            entries.forEach(([id]) => this.messageIds.delete(id));
        }
    }

    size(): number {
        return this.callIds.size;
    }

    getBloomStats(): { callIds: ReturnType<TimedBloomFilter['getStats']>; messageIds: ReturnType<TimedBloomFilter['getStats']> } {
        return {
            callIds: this.callIdBloom.getStats(),
            messageIds: this.messageIdBloom.getStats()
        };
    }

    destroy(): void {
        this.callIdBloom.destroy();
        this.messageIdBloom.destroy();
    }
}
