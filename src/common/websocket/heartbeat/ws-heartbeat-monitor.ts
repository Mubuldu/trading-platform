/**
 * WsHeartbeatMonitor sends periodic protocol PING frames and tracks
 * whether PONG frames arrive within the timeout window.
 *
 * Flow:
 *   start() → setInterval every intervalMs
 *   Each tick:
 *     1. Check if lastPongAt is too old (now - lastPongAt > timeoutMs)
 *        → if so, increment missedCount
 *     2. If missedCount >= threshold → call onTimeout(), stop interval
 *     3. Call sendPing()
 *   recordPong() → resets lastPongAt + missedCount (called from socket pong event)
 */
export class WsHeartbeatMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private missedCount = 0;
  private running = false;

  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly threshold: number;

  constructor(options: { intervalMs: number; timeoutMs: number; threshold: number }) {
    this.intervalMs = options.intervalMs;
    this.timeoutMs = options.timeoutMs;
    this.threshold = options.threshold;
  }

  /**
   * Start the heartbeat loop.
   *
   * @param sendPing  Called each tick to send the PING frame.
   * @param onTimeout Called when missed heartbeats exceed the threshold.
   */
  start(sendPing: () => void, onTimeout: () => void): void {
    if (this.running) return;
    this.running = true;
    this.lastPongAt = Date.now();
    this.missedCount = 0;

    this.timer = setInterval(() => {
      if (Date.now() - this.lastPongAt > this.timeoutMs) {
        this.missedCount++;
        if (this.missedCount >= this.threshold) {
          this.stop();
          onTimeout();
          return;
        }
      }
      sendPing();
    }, this.intervalMs);
  }

  /** Call on every PONG frame received from the server. */
  recordPong(): void {
    this.lastPongAt = Date.now();
    this.missedCount = 0;
  }

  /** Stop the heartbeat loop without triggering onTimeout. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /** Full reset — equivalent to stop() + clearing pong state. */
  reset(): void {
    this.stop();
    this.lastPongAt = 0;
    this.missedCount = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }
  get missedHeartbeats(): number {
    return this.missedCount;
  }

  /** Milliseconds since last pong. Returns Infinity when stopped/never started. */
  get msSinceLastPong(): number {
    return this.lastPongAt === 0 ? Infinity : Date.now() - this.lastPongAt;
  }
}
