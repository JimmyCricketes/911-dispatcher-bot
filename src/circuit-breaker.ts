/**
 * Circuit Breaker pattern implementation
 */

import { CIRCUIT_STATE, CircuitState, CircuitBreakerState } from './types';
import { log } from './logger';

export class CircuitBreaker {
    private readonly threshold: number;
    private readonly resetMs: number;
    private failures: number = 0;
    private lastFail: number | null = null;
    private state: CircuitState = CIRCUIT_STATE.CLOSED;

    constructor(threshold: number, resetMs: number) {
        this.threshold = threshold;
        this.resetMs = resetMs;
    }

    canRequest(): boolean {
        if (this.state === CIRCUIT_STATE.CLOSED) {
            return true;
        }

        if (this.state === CIRCUIT_STATE.OPEN &&
            this.lastFail !== null &&
            Date.now() - this.lastFail >= this.resetMs) {
            this.state = CIRCUIT_STATE.HALF_OPEN;
            return true;
        }

        return this.state === CIRCUIT_STATE.HALF_OPEN;
    }

    success(): void {
        this.failures = 0;
        this.state = CIRCUIT_STATE.CLOSED;
    }

    fail(): void {
        this.failures++;
        this.lastFail = Date.now();

        if (this.state === CIRCUIT_STATE.HALF_OPEN || this.failures >= this.threshold) {
            this.state = CIRCUIT_STATE.OPEN;
            log.warn('Circuit breaker opened', { failures: this.failures });
        }
    }

    getState(): CircuitBreakerState {
        return {
            state: this.state,
            failures: this.failures
        };
    }

    reset(): void {
        this.failures = 0;
        this.lastFail = null;
        this.state = CIRCUIT_STATE.CLOSED;
    }
}
