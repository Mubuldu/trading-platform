import { BinanceRateLimitManager } from '@modules/exchange/adapters/binance/rate-limit/binance-rate-limit.manager';
import { RateLimitError } from '@modules/exchange/errors/exchange.error';
import { BINANCE_RATE_LIMITS } from '@modules/exchange/adapters/binance/config/binance.constants';

describe('BinanceRateLimitManager', () => {
  let manager: BinanceRateLimitManager;

  beforeEach(() => {
    manager = new BinanceRateLimitManager();
  });

  describe('checkRequestWeight()', () => {
    it('allows a request when no weight has been used', () => {
      const result = manager.checkRequestWeight(100);
      expect(result.isOk()).toBe(true);
    });

    it('allows a request at WARN_THRESHOLD', () => {
      const warnWeight = Math.floor(
        BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE * BINANCE_RATE_LIMITS.WARN_THRESHOLD,
      );
      manager.updateFromHeaders({ usedWeight1m: warnWeight });
      const result = manager.checkRequestWeight(1);
      expect(result.isOk()).toBe(true);
    });

    it('blocks a request that would exceed PAUSE_THRESHOLD', () => {
      const pauseWeight = Math.floor(
        BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE * BINANCE_RATE_LIMITS.PAUSE_THRESHOLD,
      );
      manager.updateFromHeaders({ usedWeight1m: pauseWeight });
      const result = manager.checkRequestWeight(200);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(RateLimitError);
        expect(result.error.isRetryable).toBe(true);
      }
    });

    it('allows a request when usage is just below pause threshold', () => {
      const belowPauseWeight = Math.floor(
        BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE * BINANCE_RATE_LIMITS.PAUSE_THRESHOLD * 0.99,
      );
      manager.updateFromHeaders({ usedWeight1m: belowPauseWeight });
      const result = manager.checkRequestWeight(1);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('updateFromHeaders()', () => {
    it('updates weight from header', () => {
      manager.updateFromHeaders({ usedWeight1m: 1500 });
      expect(manager.weightUsed).toBe(1500);
    });

    it('ignores undefined header values', () => {
      manager.updateFromHeaders({ usedWeight1m: 100 });
      manager.updateFromHeaders({}); // no update
      expect(manager.weightUsed).toBe(100);
    });

    it('updates all available headers', () => {
      manager.updateFromHeaders({
        usedWeight1m: 2000,
        orderCount10s: 50,
        orderCountDay: 1000,
      });
      expect(manager.weightUsed).toBe(2000);
    });
  });

  describe('checkOrderRate()', () => {
    it('allows order placement when no orders have been placed', () => {
      const result = manager.checkOrderRate();
      expect(result.isOk()).toBe(true);
    });

    it('blocks order placement when 10s count is near limit', () => {
      const nearLimit = Math.floor(
        BINANCE_RATE_LIMITS.ORDERS_PER_10S * BINANCE_RATE_LIMITS.PAUSE_THRESHOLD,
      );
      manager.updateFromHeaders({ orderCount10s: nearLimit });
      const result = manager.checkOrderRate();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(RateLimitError);
      }
    });
  });

  describe('getStatus()', () => {
    it('returns three status entries', () => {
      const status = manager.getStatus();
      expect(status).toHaveLength(3);
    });

    it('returns status with correct categories', () => {
      const status = manager.getStatus();
      expect(status.map((s) => s.category)).toContain('request');
      expect(status.map((s) => s.category)).toContain('order');
      expect(status.map((s) => s.category)).toContain('raw_request');
    });

    it('reflects updated weight in status', () => {
      manager.updateFromHeaders({ usedWeight1m: 500 });
      const status = manager.getStatus();
      const requestStatus = status.find((s) => s.category === 'request');
      expect(requestStatus?.used).toBe(500);
      expect(requestStatus?.remaining).toBe(BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE - 500);
    });
  });
});
