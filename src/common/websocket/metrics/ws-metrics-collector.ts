import { WsConnectionState } from '../enums/ws-connection-state.enum';
import { WsConnectionMetrics } from '../types/ws-metrics.types';

const WINDOW_MS = 5_000; // keep 5 seconds of rate data

/**
 * WsMetricsCollector aggregates counters and rates for one WebSocket connection.
 *
 * Messages and bytes are tracked in a 5-second sliding window for rate
 * calculation. The 1-second snapshot is computed at read time from that window.
 *
 * All writes are O(1) amortised. getMetrics() is O(n) over the window size
 * (bounded by WINDOW_MS / message rate). For reasonable message rates
 * (<10 000 msg/s) this is negligible.
 */
export class WsMetricsCollector {
  private _state: WsConnectionState = WsConnectionState.DISCONNECTED;
  private connectedAt: Date | null = null;

  private totalMessages = 0;
  private totalBytes = 0;
  private totalErrors = 0;
  private reconnectCount = 0;

  /** Timestamps (ms) of recent messages for rate calculation. */
  private msgWindow: number[] = [];
  /** (timestamp, bytes) pairs for bandwidth calculation. */
  private byteWindow: { t: number; b: number }[] = [];

  // ── Mutation API ───────────────────────────────────────────────────────────

  recordMessage(byteLength: number): void {
    const now = Date.now();
    this.totalMessages++;
    this.totalBytes += byteLength;
    this.msgWindow.push(now);
    this.byteWindow.push({ t: now, b: byteLength });
    this.pruneWindows(now);
  }

  recordError(): void {
    this.totalErrors++;
  }
  recordReconnect(): void {
    this.reconnectCount++;
  }

  onStateChange(state: WsConnectionState): void {
    this._state = state;
    if (state === WsConnectionState.CONNECTED) {
      this.connectedAt = new Date();
    } else if (
      state === WsConnectionState.DISCONNECTED ||
      state === WsConnectionState.RECONNECTING ||
      state === WsConnectionState.FAILED ||
      state === WsConnectionState.STOPPED
    ) {
      this.connectedAt = null;
    }
  }

  // ── Read API ───────────────────────────────────────────────────────────────

  getMetrics(subscriptionCount: number): WsConnectionMetrics {
    const now = Date.now();
    const rateWindowStart = now - 1_000;

    this.pruneWindows(now);
    const mps = this.msgWindow.filter((t) => t >= rateWindowStart).length;
    const bps = this.byteWindow.filter((w) => w.t >= rateWindowStart).reduce((s, w) => s + w.b, 0);

    return {
      state: this._state,
      connectedAt: this.connectedAt,
      uptimeMs: this.connectedAt ? now - this.connectedAt.getTime() : 0,
      reconnectCount: this.reconnectCount,
      totalMessagesReceived: this.totalMessages,
      totalBytesReceived: this.totalBytes,
      totalErrors: this.totalErrors,
      messagesPerSecond: mps,
      bytesPerSecond: bps,
      subscriptionCount,
    };
  }

  reset(): void {
    this.totalMessages = 0;
    this.totalBytes = 0;
    this.totalErrors = 0;
    this.reconnectCount = 0;
    this.connectedAt = null;
    this.msgWindow = [];
    this.byteWindow = [];
  }

  private pruneWindows(now: number): void {
    const cutoff = now - WINDOW_MS;
    if (this.msgWindow.length > 0 && this.msgWindow[0] < cutoff) {
      this.msgWindow = this.msgWindow.filter((t) => t >= cutoff);
    }
    if (this.byteWindow.length > 0 && this.byteWindow[0].t < cutoff) {
      this.byteWindow = this.byteWindow.filter((w) => w.t >= cutoff);
    }
  }
}
