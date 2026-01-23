/**
 * Rate Limiter - Token bucket implementation
 */

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export class RateLimiter {
    private tokens: number;
    private readonly max: number;
    private last: number;

    constructor(perSec: number) {
        this.tokens = perSec;
        this.max = perSec;
        this.last = Date.now();
    }

    async acquire(): Promise<void> {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const now = Date.now();
            this.tokens = Math.min(
                this.max,
                this.tokens + ((now - this.last) / 1000) * this.max
            );
            this.last = now;

            if (this.tokens >= 1) {
                this.tokens--;
                return;
            }

            await sleep(Math.ceil(((1 - this.tokens) / this.max) * 1000));
        }
    }

    getAvailableTokens(): number {
        return this.tokens;
    }
}
