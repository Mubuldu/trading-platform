import { ExponentialBackoff } from '@common/resilience/backoff.strategy';

/**
 * WsReconnectManager schedules reconnect attempts using exponential backoff
 * with full jitter to prevent thundering herd.
 *
 * Jitter algorithm (full jitter):
 *   delay = random(0, min(maxDelayMs, baseDelayMs * 2^attempt))
 *
 * Stable reset: if the connection stays up for stableThresholdMs the attempt
 * counter is reset to 0. This prevents a briefly-flaky connection from
 * burning through all retry budget.
 *
 * maxAttempts = -1 disables the attempt limit (retry forever).
 */
export class WsReconnectManager {
  private attempt = 0;
  private reconnectCount = 0;
  private lastDelayMs = 0;
  private connectedAt: number | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly backoff: ExponentialBackoff;
  private readonly maxAttempts: number;
  private readonly stableThresholdMs: number;

  constructor(options: {
    baseDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
    stableThresholdMs: number;
  }) {
    this.backoff = new ExponentialBackoff({
      baseMs: options.baseDelayMs,
      maxMs: options.maxDelayMs,
      jitter: true,
    });
    this.maxAttempts = options.maxAttempts;
    this.stableThresholdMs = options.stableThresholdMs;
  }

  /** Call when a connection successfully opens. */
  onConnected(): void {
    this.connectedAt = Date.now();
  }

  /**
   * Call periodically (e.g. every 5 s) while connected.
   * Resets the attempt counter once the connection has been stable long enough.
   */
  checkStability(): void {
    if (this.connectedAt !== null && Date.now() - this.connectedAt >= this.stableThresholdMs) {
      this.resetAttempts();
    }
  }

  /**
   * Schedule the next reconnect attempt.
   *
   * @param callback Invoked after the calculated delay.
   * @returns The delay in ms, or null if max attempts have been exceeded.
   */
  scheduleReconnect(callback: () => void): { delayMs: number } | null {
    if (this.maxAttempts !== -1 && this.attempt >= this.maxAttempts) {
      return null;
    }

    this.attempt++;
    this.reconnectCount++;
    // Attempt 1 uses index 0 for backoff
    const delayMs = Math.floor(this.backoff.getDelayMs(this.attempt));
    this.lastDelayMs = delayMs;
    this.connectedAt = null;

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      callback();
    }, delayMs);

    return { delayMs };
  }

  /** Cancel a pending reconnect without changing the attempt counter. */
  cancel(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /** Reset attempt counter (used after the manager is manually stopped). */
  resetAttempts(): void {
    this.attempt = 0;
    this.lastDelayMs = 0;
    this.connectedAt = null;
  }

  get currentAttempt(): number {
    return this.attempt;
  }
  get totalReconnectCount(): number {
    return this.reconnectCount;
  }
  get lastScheduledDelayMs(): number {
    return this.lastDelayMs;
  }
  get hasPending(): boolean {
    return this.pendingTimer !== null;
  }
}
