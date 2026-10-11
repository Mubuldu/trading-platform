import { CircuitBreakerOpenError } from '@common/errors/infrastructure.error';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  isFailure?: (error: unknown) => boolean;
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailureAt: Date | null;
}

function defaultIsFailure(_error: unknown): boolean {
  return true;
}

/**
 * CircuitBreaker prevents cascading failures in distributed systems.
 *
 * State machine:
 *  CLOSED   → normal operation. Failures increment a counter. When the
 *             counter reaches failureThreshold, transitions to OPEN.
 *  OPEN     → all calls are rejected immediately with CircuitBreakerOpenError.
 *             After timeoutMs, transitions to HALF_OPEN to probe recovery.
 *  HALF_OPEN → limited calls pass through. successThreshold consecutive
 *             successes transition back to CLOSED. A single failure returns
 *             to OPEN with the full timeout reset.
 *
 * The isFailure predicate controls which errors count as circuit failures.
 * HTTP 4xx errors (bad client requests) should typically NOT trip the circuit.
 *
 * The onStateChange callback enables metrics, alerting, and logging without
 * coupling the circuit breaker to any specific infrastructure.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private totalRequests = 0;
  private lastFailureAt: Date | null = null;
  private nextAttemptAt: number | null = null;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeoutMs: number;
  private readonly isFailure: (error: unknown) => boolean;
  private readonly onStateChange:
    ((from: CircuitBreakerState, to: CircuitBreakerState) => void) | undefined;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold;
    this.successThreshold = options.successThreshold;
    this.timeoutMs = options.timeoutMs;
    this.isFailure = options.isFailure ?? defaultIsFailure;
    this.onStateChange = options.onStateChange;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() < (this.nextAttemptAt ?? 0)) {
        throw new CircuitBreakerOpenError(this.name);
      }
      this.transitionTo(CircuitBreakerState.HALF_OPEN);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  get stats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount,
      totalRequests: this.totalRequests,
      lastFailureAt: this.lastFailureAt,
    };
  }

  reset(): void {
    this.transitionTo(CircuitBreakerState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
  }

  private onSuccess(): void {
    this.successCount++;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.successCount >= this.successThreshold) {
        this.transitionTo(CircuitBreakerState.CLOSED);
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  private onFailure(error: unknown): void {
    if (!this.isFailure(error)) return;

    this.failureCount++;
    this.lastFailureAt = new Date();

    if (
      this.state === CircuitBreakerState.HALF_OPEN ||
      this.failureCount >= this.failureThreshold
    ) {
      this.successCount = 0;
      this.nextAttemptAt = Date.now() + this.timeoutMs;
      this.transitionTo(CircuitBreakerState.OPEN);
    }
  }

  private transitionTo(next: CircuitBreakerState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.onStateChange?.(prev, next);
  }
}
