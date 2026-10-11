import { LatencySample, WsLatencyMetrics } from '../types/ws-metrics.types';

const DEFAULT_CAPACITY = 1_000;
const DRIFT_CAPACITY = 100;

/** Fixed-size circular buffer for latency samples. */
class CircularBuffer {
  private readonly buf: number[];
  private head = 0;
  private _size = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array<number>(capacity).fill(0);
  }

  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  toSortedArray(): number[] {
    return this.buf.slice(0, this._size).sort((a, b) => a - b);
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
    this.buf.fill(0);
  }
}

function computeStats(sorted: number[]): LatencySample {
  if (sorted.length === 0) {
    return { current: 0, min: 0, max: 0, avg: 0, p95: 0, p99: 0, sampleCount: 0 };
  }
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const pAt = (pct: number): number => sorted[Math.max(0, Math.ceil(sorted.length * pct) - 1)]!;

  return {
    current: sorted[sorted.length - 1],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p95: pAt(0.95),
    p99: pAt(0.99),
    sampleCount: sorted.length,
  };
}

/**
 * WsLatencyMonitor records three types of latency over a rolling window:
 *
 *  networkLatency     — ms from socket receive event to message handler
 *  processingLatency  — ms from socket receive to normalized event published
 *  messageDelay       — ms between exchange event timestamp and local receive
 *
 * Each metric is stored in a fixed circular buffer. Stats (min/max/avg/p95/p99)
 * are computed on demand when getMetrics() is called.
 */
export class WsLatencyMonitor {
  private readonly networkBuf = new CircularBuffer(DEFAULT_CAPACITY);
  private readonly processingBuf = new CircularBuffer(DEFAULT_CAPACITY);
  private readonly delayBuf = new CircularBuffer(DEFAULT_CAPACITY);
  private readonly driftBuf = new CircularBuffer(DRIFT_CAPACITY);

  /** Record time from socket receive to handler dispatch (ms). */
  recordNetworkLatency(ms: number): void {
    this.networkBuf.push(ms);
  }

  /** Record time from socket receive to normalized event published (ms). */
  recordProcessingLatency(ms: number): void {
    this.processingBuf.push(ms);
  }

  /**
   * Record message delay: difference between the local receive time and the
   * exchange event timestamp embedded in the message payload.
   *
   * Positive values indicate messages arriving after the exchange timestamp
   * (expected). Negative values indicate clock skew (local clock is ahead).
   */
  recordMessageDelay(exchangeTimestampMs: number, localReceiveMs: number): void {
    const delay = localReceiveMs - exchangeTimestampMs;
    this.delayBuf.push(delay);
    this.driftBuf.push(delay);
  }

  getMetrics(): WsLatencyMetrics {
    const driftSamples = this.driftBuf.toSortedArray();
    const clockDriftMs =
      driftSamples.length > 0 ? driftSamples.reduce((a, b) => a + b, 0) / driftSamples.length : 0;

    return {
      networkLatencyMs: computeStats(this.networkBuf.toSortedArray()),
      processingLatencyMs: computeStats(this.processingBuf.toSortedArray()),
      messageDelayMs: computeStats(this.delayBuf.toSortedArray()),
      clockDriftMs,
    };
  }

  /** Clear all samples (call on reconnect to start fresh). */
  reset(): void {
    this.networkBuf.clear();
    this.processingBuf.clear();
    this.delayBuf.clear();
    this.driftBuf.clear();
  }
}
