/**
 * Bloom Filter implementation for efficient duplicate detection
 * Space-efficient probabilistic data structure for set membership testing
 */

export class BloomFilter {
    private readonly bits: Uint8Array;
    private readonly size: number;
    private readonly hashCount: number;
    private itemCount: number = 0;

    /**
     * Create a new Bloom filter
     * @param expectedItems - Expected number of items to store
     * @param falsePositiveRate - Desired false positive rate (default 0.01 = 1%)
     */
    constructor(expectedItems: number = 10000, falsePositiveRate: number = 0.01) {
        // Calculate optimal size: m = -n * ln(p) / (ln(2)^2)
        this.size = Math.ceil(-expectedItems * Math.log(falsePositiveRate) / (Math.LN2 * Math.LN2));
        // Calculate optimal hash count: k = m/n * ln(2)
        this.hashCount = Math.ceil((this.size / expectedItems) * Math.LN2);
        // Allocate bit array (using bytes, 8 bits each)
        this.bits = new Uint8Array(Math.ceil(this.size / 8));
    }

    /**
     * MurmurHash3-inspired hash function
     */
    private hash(str: string, seed: number): number {
        let h = seed;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x5bd1e995);
            h ^= h >>> 15;
        }
        return Math.abs(h) % this.size;
    }

    /**
     * Generate multiple hash values using double hashing technique
     */
    private getHashes(item: string): number[] {
        const hashes: number[] = [];
        const hash1 = this.hash(item, 0x9747b28c);
        const hash2 = this.hash(item, 0xc6a4a793);

        for (let i = 0; i < this.hashCount; i++) {
            // Double hashing: h(i) = h1 + i * h2
            hashes.push(Math.abs((hash1 + i * hash2)) % this.size);
        }
        return hashes;
    }

    /**
     * Add an item to the filter
     */
    add(item: string): void {
        const hashes = this.getHashes(item);
        for (const hash of hashes) {
            const byteIndex = Math.floor(hash / 8);
            const bitIndex = hash % 8;
            this.bits[byteIndex] |= (1 << bitIndex);
        }
        this.itemCount++;
    }

    /**
     * Check if an item might be in the filter
     * Returns true if item is PROBABLY in the set (may be false positive)
     * Returns false if item is DEFINITELY NOT in the set
     */
    mightContain(item: string): boolean {
        const hashes = this.getHashes(item);
        for (const hash of hashes) {
            const byteIndex = Math.floor(hash / 8);
            const bitIndex = hash % 8;
            if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check and add in one operation (returns true if was already present)
     */
    checkAndAdd(item: string): boolean {
        const wasPresent = this.mightContain(item);
        if (!wasPresent) {
            this.add(item);
        }
        return wasPresent;
    }

    /**
     * Get current estimated false positive rate based on fill ratio
     */
    getEstimatedFalsePositiveRate(): number {
        const fillRatio = this.itemCount / this.size;
        return Math.pow(1 - Math.exp(-this.hashCount * fillRatio), this.hashCount);
    }

    /**
     * Get filter statistics
     */
    getStats(): { size: number; itemCount: number; hashCount: number; estimatedFPR: number } {
        return {
            size: this.size,
            itemCount: this.itemCount,
            hashCount: this.hashCount,
            estimatedFPR: this.getEstimatedFalsePositiveRate()
        };
    }

    /**
     * Clear the filter
     */
    clear(): void {
        this.bits.fill(0);
        this.itemCount = 0;
    }
}

/**
 * Time-decaying Bloom Filter with automatic rotation
 * Uses multiple generations to allow old entries to expire
 */
export class TimedBloomFilter {
    private filters: BloomFilter[];
    private currentIndex: number = 0;
    private readonly rotationMs: number;
    private lastRotation: number;
    private rotationTimer: NodeJS.Timeout | null = null;

    /**
     * Create a timed bloom filter
     * @param expectedItems - Expected items per time window
     * @param rotationMs - How often to rotate generations (default 30 min)
     * @param generations - Number of generations to keep (default 2)
     */
    constructor(
        expectedItems: number = 10000,
        rotationMs: number = 1800000,
        generations: number = 2
    ) {
        this.filters = Array.from(
            { length: generations },
            () => new BloomFilter(expectedItems, 0.01)
        );
        this.rotationMs = rotationMs;
        this.lastRotation = Date.now();
        this.startRotation();
    }

    private startRotation(): void {
        this.rotationTimer = setInterval(() => {
            this.rotate();
        }, this.rotationMs);
        this.rotationTimer.unref();
    }

    private rotate(): void {
        this.currentIndex = (this.currentIndex + 1) % this.filters.length;
        this.filters[this.currentIndex].clear();
        this.lastRotation = Date.now();
    }

    /**
     * Check if item might exist in any generation
     */
    mightContain(item: string): boolean {
        return this.filters.some(filter => filter.mightContain(item));
    }

    /**
     * Add item to current generation
     */
    add(item: string): void {
        this.filters[this.currentIndex].add(item);
    }

    /**
     * Check and add - returns true if was already present
     */
    checkAndAdd(item: string): boolean {
        if (this.mightContain(item)) {
            return true;
        }
        this.add(item);
        return false;
    }

    /**
     * Get combined stats from all generations
     */
    getStats(): { totalItems: number; generations: number; rotationMs: number } {
        const totalItems = this.filters.reduce(
            (sum, f) => sum + f.getStats().itemCount,
            0
        );
        return {
            totalItems,
            generations: this.filters.length,
            rotationMs: this.rotationMs
        };
    }

    /**
     * Cleanup timer
     */
    destroy(): void {
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
        }
    }
}
