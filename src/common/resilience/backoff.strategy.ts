/**
 * BackoffStrategy determines how long to wait between retry attempts.
 *
 * Choosing the wrong strategy can cause thundering herd (all clients retry at
 * the same moment) or excessive wait times. Always add jitter in distributed
 * systems.
 */
export interface BackoffStrategy {
  getDelayMs(attempt: number): number;
}

export interface ExponentialBackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: boolean;
}

/**
 * ExponentialBackoff: delay = min(baseMs * factor^(attempt-1), maxMs)
 *
 * With jitter enabled (default), adds a random component to spread retries
 * across time — critical in a multi-client trading environment to avoid
 * synchronised storm against the same endpoint.
 */
export class ExponentialBackoff implements BackoffStrategy {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly factor: number;
  private readonly jitter: boolean;

  constructor(options: ExponentialBackoffOptions = {}) {
    this.baseMs = options.baseMs ?? 100;
    this.maxMs = options.maxMs ?? 30_000;
    this.factor = options.factor ?? 2;
    this.jitter = options.jitter ?? true;
  }

  getDelayMs(attempt: number): number {
    const exponential = Math.min(this.baseMs * Math.pow(this.factor, attempt - 1), this.maxMs);
    if (!this.jitter) {
      return exponential;
    }
    return Math.random() * exponential;
  }
}

/**
 * LinearBackoff: delay = baseMs * attempt
 * Suitable when upstream systems have predictable recovery curves.
 */
export class LinearBackoff implements BackoffStrategy {
  constructor(
    private readonly baseMs: number = 500,
    private readonly maxMs: number = 10_000,
  ) {}

  getDelayMs(attempt: number): number {
    return Math.min(this.baseMs * attempt, this.maxMs);
  }
}

/**
 * ConstantBackoff: delay = fixed value regardless of attempt number.
 * Useful for rate-limited APIs with fixed retry-after windows.
 */
export class ConstantBackoff implements BackoffStrategy {
  constructor(private readonly delayMs: number = 1_000) {}

  getDelayMs(_attempt: number): number {
    return this.delayMs;
  }
}

export class NoBackoff implements BackoffStrategy {
  getDelayMs(_attempt: number): number {
    return 0;
  }
}
