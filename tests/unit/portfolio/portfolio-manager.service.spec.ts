import { PortfolioManagerService } from '../../../src/modules/portfolio/application/services/portfolio-manager.service';
import { PortfolioMetricsService } from '../../../src/modules/portfolio/application/services/portfolio-metrics.service';
import { PortfolioExposureService } from '../../../src/modules/portfolio/application/services/portfolio-exposure.service';
import { CapitalAllocationService } from '../../../src/modules/portfolio/application/services/capital-allocation.service';
import { PortfolioConstraintsService } from '../../../src/modules/portfolio/application/services/portfolio-constraints.service';
import { PortfolioCacheService } from '../../../src/modules/portfolio/application/services/portfolio-cache.service';
import { ConsumedMessage } from '../../../src/infrastructure/redis/streams/stream-event.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePositionUpdateMsg(overrides: Record<string, unknown> = {}): ConsumedMessage {
  return {
    streamId: '1-0',
    streamName: 'position:update',
    consumerGroup: 'portfolio-manager',
    consumerName: 'portfolio-manager-1',
    event: {
      eventId: 'evt-1',
      correlationId: 'corr-1',
      eventType: 'PositionUpdate',
      exchange: 'BINANCE',
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      producer: 'PositionManagerService',
      schemaVersion: '1.0',
      metadata: {},
      payload: {
        positionId: 'BINANCE:BTCUSDT',
        exchangeId: 'BINANCE',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        state: 'OPEN',
        quantity: 1.0,
        averageEntryPrice: 50_000,
        unrealizedPnl: 1_000,
        realizedPnl: 0,
        totalFees: 50,
        strategyId: 'strat-1',
        updatedAt: Date.now(),
        ...overrides,
      },
    },
  } as unknown as ConsumedMessage;
}

// ── Build service ─────────────────────────────────────────────────────────────

function buildService() {
  const cacheStore = new Map<string, string>();

  const mockHash = {
    set: jest.fn(async (_key: string, field: string, value: string) => {
      cacheStore.set(field, value);
    }),
    get: jest.fn(async (_key: string, field: string) => cacheStore.get(field) ?? null),
    delete: jest.fn(async (_key: string, field: string) => {
      cacheStore.delete(field);
    }),
    getAll: jest.fn(async (_key: string) => {
      const result: Record<string, string> = {};
      for (const [k, v] of cacheStore.entries()) result[k] = v;
      return Object.keys(result).length ? result : null;
    }),
  };

  const mockPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
  const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const mockConfig = {
    get: jest.fn().mockReturnValue({
      enabled: true,
      consumerGroup: 'portfolio-manager',
      defaultEquityUsd: 100_000,
      defaultAccountId: 'default',
      allocationMethod: 'EQUAL_WEIGHT',
      maxPositionSizePercent: 20,
      maxExposurePercent: 80,
      maxLeverage: 3,
      maxCorrelationThreshold: 0.8,
      maxAssetAllocationPercent: 40,
      rollingDrawdownWindowDays: 30,
      riskFreeRateAnnual: 0.05,
      tradingDaysPerYear: 252,
      snapshotIntervalMs: 3_600_000,
      metricsRetentionDays: 365,
    }),
  };

  const metricsService = new PortfolioMetricsService();
  const exposureService = new PortfolioExposureService();
  const allocationService = new CapitalAllocationService();
  const constraintsService = new PortfolioConstraintsService();
  const cache = new PortfolioCacheService(mockHash as any);

  const service = new PortfolioManagerService(
    mockConfig as any,
    mockLogger as any,
    {} as any, // consumer — not used in unit tests
    {} as any, // consumerManager
    mockPublisher as any,
    metricsService,
    exposureService,
    allocationService,
    constraintsService,
    cache,
  );

  return { service, mockPublisher, mockLogger, cacheStore };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PortfolioManagerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts with null state', () => {
      const { service } = buildService();
      expect(service.getState()).toBeNull();
    });

    it('starts with no open positions', () => {
      const { service } = buildService();
      expect(service.getOpenPositions()).toHaveLength(0);
    });
  });

  // ── handlePositionUpdate (via processFill-like path) ─────────────────────

  describe('processing position updates', () => {
    it('computes state after receiving a position update', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());

      const state = service.getState();
      expect(state).not.toBeNull();
      expect(state!.openPositionCount).toBe(1);
    });

    it('accumulates multiple positions', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          positionId: 'BINANCE:BTCUSDT',
          symbol: 'BTCUSDT',
          notionalValue: 50_000,
        }),
      );
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          positionId: 'BINANCE:ETHUSDT',
          symbol: 'ETHUSDT',
          notionalValue: 20_000,
        }),
      );

      const state = service.getState();
      expect(state!.openPositionCount).toBe(2);
    });

    it('removes FLAT positions from open list', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          state: 'FLAT',
          quantity: 0,
        }),
      );

      const open = service.getOpenPositions();
      expect(open).toHaveLength(0);
    });

    it('updates existing position on subsequent updates', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg({ quantity: 1.0 }));
      await (service as any).handlePositionUpdate(makePositionUpdateMsg({ quantity: 2.0 }));

      const open = service.getOpenPositions();
      expect(open).toHaveLength(1);
      expect(open[0].quantity).toBe(2.0);
    });
  });

  // ── Portfolio state correctness ───────────────────────────────────────────

  describe('portfolio state correctness', () => {
    it('computes totalExposure correctly', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          quantity: 2.0,
          averageEntryPrice: 50_000,
        }),
      );

      const state = service.getState();
      expect(state!.totalExposure).toBeCloseTo(100_000, 5);
    });

    it('computes netPnl as realizedPnl + unrealizedPnl - fees', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          realizedPnl: 500,
          unrealizedPnl: 300,
          totalFees: 50,
        }),
      );

      const state = service.getState();
      expect(state!.netPnl).toBeCloseTo(750, 5);
    });

    it('computes leverage as totalExposure / equity', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          quantity: 2,
          averageEntryPrice: 50_000,
        }),
      );

      const state = service.getState();
      // equity=100_000, exposure=100_000 → leverage=1
      expect(state!.totalLeverage).toBeCloseTo(1, 5);
    });
  });

  // ── Exposure ──────────────────────────────────────────────────────────────

  describe('exposure computation', () => {
    it('exposure is null before first update', () => {
      const { service } = buildService();
      expect(service.getExposure()).toBeNull();
    });

    it('computes bySymbol exposure', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          symbol: 'BTCUSDT',
          notionalValue: 50_000,
        }),
      );

      const exposure = service.getExposure();
      expect(exposure!.bySymbol['BTCUSDT']).toBe(50_000);
    });
  });

  // ── Metrics ───────────────────────────────────────────────────────────────

  describe('metrics computation', () => {
    it('metrics are null before first update', () => {
      const { service } = buildService();
      expect(service.getMetrics()).toBeNull();
    });

    it('metrics are computed after first update', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());
      expect(service.getMetrics()).not.toBeNull();
    });

    it('metrics contain computedAt', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());
      expect(service.getMetrics()!.computedAt).toBeGreaterThan(0);
    });
  });

  // ── Publishing ────────────────────────────────────────────────────────────

  describe('stream publishing', () => {
    it('publishes portfolio:update on position update', async () => {
      const { service, mockPublisher } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());

      const calls: string[][] = mockPublisher.publish.mock.calls;
      const portfolioUpdate = calls.find((c) => c[0] === 'portfolio:update');
      expect(portfolioUpdate).toBeDefined();
    });

    it('publishes portfolio:metrics on position update', async () => {
      const { service, mockPublisher } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());

      const calls: string[][] = mockPublisher.publish.mock.calls;
      const metricsUpdate = calls.find((c) => c[0] === 'portfolio:metrics');
      expect(metricsUpdate).toBeDefined();
    });

    it('publishes portfolio:risk on position update', async () => {
      const { service, mockPublisher } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());

      const calls: string[][] = mockPublisher.publish.mock.calls;
      const riskUpdate = calls.find((c) => c[0] === 'portfolio:risk');
      expect(riskUpdate).toBeDefined();
    });

    it('publishes three events per position update', async () => {
      const { service, mockPublisher } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());
      expect(mockPublisher.publish).toHaveBeenCalledTimes(3);
    });
  });

  // ── Multiple strategies ───────────────────────────────────────────────────

  describe('multiple strategies', () => {
    it('allocation includes all unique strategies', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg({ strategyId: 'strat-a' }));
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          positionId: 'BINANCE:ETHUSDT',
          symbol: 'ETHUSDT',
          strategyId: 'strat-b',
        }),
      );

      const alloc = service.getAllocation();
      expect(alloc!.allocations).toHaveLength(2);
      const ids = alloc!.allocations.map((a) => a.strategyId);
      expect(ids).toContain('strat-a');
      expect(ids).toContain('strat-b');
    });
  });

  // ── Constraint violations ─────────────────────────────────────────────────

  describe('constraint violation logging', () => {
    it('logs warning when position breaches max leverage', async () => {
      const { service, mockLogger } = buildService();
      // equity=100_000, leverage limit=3x, so 400_000 exposure → 4x → violation
      await (service as any).handlePositionUpdate(
        makePositionUpdateMsg({
          quantity: 8,
          averageEntryPrice: 50_000,
        }),
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('constraint violations'),
        expect.anything(),
      );
    });
  });

  // ── Large portfolio ───────────────────────────────────────────────────────

  describe('large portfolio with many positions', () => {
    it('handles 50 positions without error', async () => {
      const { service } = buildService();
      const symbols = Array.from({ length: 50 }, (_, i) => `COIN${i}USDT`);

      for (const symbol of symbols) {
        await (service as any).handlePositionUpdate(
          makePositionUpdateMsg({
            positionId: `BINANCE:${symbol}`,
            symbol,
            quantity: 1,
            averageEntryPrice: 100,
          }),
        );
      }

      const open = service.getOpenPositions();
      expect(open).toHaveLength(50);
    });
  });

  // ── Daily snapshot ────────────────────────────────────────────────────────

  describe('daily snapshot', () => {
    it('appends a daily record on takeDailySnapshot', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());
      await (service as any).takeDailySnapshot();

      const records = service.getDailyRecords();
      expect(records).toHaveLength(1);
      expect(records[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('updates existing record for same date (idempotent)', async () => {
      const { service } = buildService();
      await (service as any).handlePositionUpdate(makePositionUpdateMsg());
      await (service as any).takeDailySnapshot();
      await (service as any).takeDailySnapshot();

      const records = service.getDailyRecords();
      expect(records).toHaveLength(1);
    });
  });
});
