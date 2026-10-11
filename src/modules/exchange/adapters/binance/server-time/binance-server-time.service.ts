import { Injectable } from '@nestjs/common';
import { BINANCE_CLOCK_DRIFT_THRESHOLD_MS } from '../config/binance.constants';

/**
 * BinanceServerTimeService manages the offset between local system time
 * and Binance server time, enabling accurate request timestamp generation.
 *
 * Why this matters: Binance rejects requests where the timestamp deviates
 * from server time by more than recvWindow (default 5000ms). A server with
 * clock drift, an NTP issue, or a high-latency network path will send
 * timestamps that Binance considers stale or in the future — causing -1021
 * (INVALID_TIMESTAMP) errors that look like authentication failures.
 *
 * The offset is computed at adapter initialization and periodically refreshed
 * by the adapter during health checks or on -1021 errors.
 *
 * This service has NO HTTP dependency. The adapter fetches the server time
 * via the REST client and calls updateOffset() with the result.
 */
@Injectable()
export class BinanceServerTimeService {
  private offsetMs = 0;
  private lastSyncAt: Date | null = null;

  /**
   * Updates the local-to-server clock offset.
   *
   * @param serverTime - The server time returned by GET /api/v3/time.
   * @param requestRoundTripMs - Estimated round-trip latency (used to
   *   correct for the time elapsed during the API call). Half the round
   *   trip is a common approximation.
   */
  updateOffset(serverTime: Date, requestRoundTripMs = 0): void {
    const localTimeAtReceipt = Date.now();
    const correctedServerTime = serverTime.getTime() + Math.floor(requestRoundTripMs / 2);
    this.offsetMs = correctedServerTime - localTimeAtReceipt;
    this.lastSyncAt = new Date();
  }

  /**
   * Returns the current timestamp adjusted for server clock drift.
   * Use this value as the `timestamp` parameter in signed requests.
   */
  getTimestamp(): number {
    return Date.now() + this.offsetMs;
  }

  /**
   * Returns true if the server time observed in a response deviates
   * significantly from the expected time. Triggers a re-sync.
   */
  detectDrift(observedServerTime: Date): boolean {
    const expectedServerTime = Date.now() + this.offsetMs;
    const drift = Math.abs(observedServerTime.getTime() - expectedServerTime);
    return drift > BINANCE_CLOCK_DRIFT_THRESHOLD_MS;
  }

  get currentOffsetMs(): number {
    return this.offsetMs;
  }

  get lastSynchronizedAt(): Date | null {
    return this.lastSyncAt;
  }

  get isSynchronized(): boolean {
    return this.lastSyncAt !== null;
  }
}
