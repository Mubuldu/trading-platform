import { Injectable } from '@nestjs/common';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { RateLimitStatus } from '@modules/exchange/models/exchange.models';
import { RateLimitError } from '@modules/exchange/errors/exchange.error';
import { Result, ok, err } from '@common/result';
import { BINANCE_RATE_LIMITS } from '../config/binance.constants';
import { BinanceResponseHeaders } from '../client/binance-http.types';

/**
 * BinanceRateLimitManager tracks Binance Spot API rate limit consumption.
 *
 * Binance enforces three independent rate limit windows:
 *   1. REQUEST_WEIGHT (per minute): total weight across all endpoints
 *   2. ORDER_COUNT (per 10 seconds): order submission rate
 *   3. ORDER_COUNT (per day): cumulative daily order count
 *
 * After each response, Binance returns current usage in headers:
 *   X-MBX-USED-WEIGHT-1M    → current weight used this minute
 *   X-MBX-ORDER-COUNT-10S   → orders placed in this 10-second window
 *   X-MBX-ORDER-COUNT-1D    → orders placed today
 *
 * Before each request, the manager checks whether the request would
 * cause a limit violation. If usage is above PAUSE_THRESHOLD, the
 * request is rejected with RateLimitError.isRetryable=true so the
 * caller applies exponential backoff.
 *
 * Reset time estimation: Binance resets the weight window at the start
 * of each minute UTC. We estimate the reset time from the local clock.
 */
@Injectable()
export class BinanceRateLimitManager {
  private usedWeight1m = 0;
  private usedOrderCount10s = 0;
  private usedOrderCountDay = 0;
  private weightWindowResetAt: Date = this.nextMinuteBoundary();
  private orderWindowResetAt: Date = this.next10SecondBoundary();
  private dayWindowResetAt: Date = this.nextDayBoundary();
  private lastUpdatedAt: Date = new Date();

  /**
   * Updates rate limit counters from the HTTP response headers.
   * Called after every successful or rate-limited response.
   */
  updateFromHeaders(headers: BinanceResponseHeaders): void {
    if (headers.usedWeight1m !== undefined) {
      this.usedWeight1m = headers.usedWeight1m;
    }
    if (headers.orderCount10s !== undefined) {
      this.usedOrderCount10s = headers.orderCount10s;
    }
    if (headers.orderCountDay !== undefined) {
      this.usedOrderCountDay = headers.orderCountDay;
    }
    this.maybeResetWindows();
    this.lastUpdatedAt = new Date();
  }

  /**
   * Checks whether the current usage allows a request of the given weight.
   *
   * Returns ok(void) if the request can proceed.
   * Returns err(RateLimitError) if the request would exceed the limit.
   * The caller should apply the retryAfterMs from the error before retrying.
   */
  checkRequestWeight(weight: number): Result<void, RateLimitError> {
    this.maybeResetWindows();

    const projectedUsage = this.usedWeight1m + weight;
    const limit = BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE;
    const pauseAt = limit * BINANCE_RATE_LIMITS.PAUSE_THRESHOLD;

    if (projectedUsage > pauseAt) {
      const retryAfterMs = Math.max(0, this.weightWindowResetAt.getTime() - Date.now());
      return err(
        new RateLimitError(
          ExchangeId.BINANCE_SPOT,
          retryAfterMs,
          { usedWeight: this.usedWeight1m, requestWeight: weight, limit, pauseThreshold: pauseAt },
          `Binance request weight limit approaching: ${this.usedWeight1m}/${limit} used, request weight ${weight}`,
        ),
      );
    }

    return ok(undefined);
  }

  /**
   * Checks whether placing an order is currently permitted.
   */
  checkOrderRate(): Result<void, RateLimitError> {
    this.maybeResetWindows();

    if (
      this.usedOrderCount10s >=
      BINANCE_RATE_LIMITS.ORDERS_PER_10S * BINANCE_RATE_LIMITS.PAUSE_THRESHOLD
    ) {
      const retryAfterMs = Math.max(0, this.orderWindowResetAt.getTime() - Date.now());
      return err(
        new RateLimitError(
          ExchangeId.BINANCE_SPOT,
          retryAfterMs,
          { count10s: this.usedOrderCount10s, limit: BINANCE_RATE_LIMITS.ORDERS_PER_10S },
          'Binance order rate limit approaching (10s window)',
        ),
      );
    }

    if (
      this.usedOrderCountDay >=
      BINANCE_RATE_LIMITS.ORDERS_PER_DAY * BINANCE_RATE_LIMITS.PAUSE_THRESHOLD
    ) {
      const retryAfterMs = Math.max(0, this.dayWindowResetAt.getTime() - Date.now());
      return err(
        new RateLimitError(
          ExchangeId.BINANCE_SPOT,
          retryAfterMs,
          { countDay: this.usedOrderCountDay, limit: BINANCE_RATE_LIMITS.ORDERS_PER_DAY },
          'Binance daily order limit approaching',
        ),
      );
    }

    return ok(undefined);
  }

  /**
   * Returns the current rate limit status for all three windows.
   * Exposed via ExchangeMetadataProvider.getRateLimitStatus().
   */
  getStatus(): RateLimitStatus[] {
    const now = new Date();
    return [
      {
        exchangeId: ExchangeId.BINANCE_SPOT,
        category: 'request',
        limit: BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE,
        used: this.usedWeight1m,
        remaining: Math.max(0, BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE - this.usedWeight1m),
        weight: this.usedWeight1m,
        resetsAt: this.weightWindowResetAt,
        checkedAt: now,
      },
      {
        exchangeId: ExchangeId.BINANCE_SPOT,
        category: 'order',
        limit: BINANCE_RATE_LIMITS.ORDERS_PER_10S,
        used: this.usedOrderCount10s,
        remaining: Math.max(0, BINANCE_RATE_LIMITS.ORDERS_PER_10S - this.usedOrderCount10s),
        weight: 1,
        resetsAt: this.orderWindowResetAt,
        checkedAt: now,
      },
      {
        exchangeId: ExchangeId.BINANCE_SPOT,
        category: 'raw_request',
        limit: BINANCE_RATE_LIMITS.ORDERS_PER_DAY,
        used: this.usedOrderCountDay,
        remaining: Math.max(0, BINANCE_RATE_LIMITS.ORDERS_PER_DAY - this.usedOrderCountDay),
        weight: 1,
        resetsAt: this.dayWindowResetAt,
        checkedAt: now,
      },
    ];
  }

  get weightUsed(): number {
    return this.usedWeight1m;
  }

  get lastUpdated(): Date {
    return this.lastUpdatedAt;
  }

  private maybeResetWindows(): void {
    const now = Date.now();

    if (now >= this.weightWindowResetAt.getTime()) {
      this.usedWeight1m = 0;
      this.weightWindowResetAt = this.nextMinuteBoundary();
    }

    if (now >= this.orderWindowResetAt.getTime()) {
      this.usedOrderCount10s = 0;
      this.orderWindowResetAt = this.next10SecondBoundary();
    }

    if (now >= this.dayWindowResetAt.getTime()) {
      this.usedOrderCountDay = 0;
      this.dayWindowResetAt = this.nextDayBoundary();
    }
  }

  private nextMinuteBoundary(): Date {
    const now = Date.now();
    return new Date(now - (now % 60_000) + 60_000);
  }

  private next10SecondBoundary(): Date {
    const now = Date.now();
    return new Date(now - (now % 10_000) + 10_000);
  }

  private nextDayBoundary(): Date {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return next;
  }
}
