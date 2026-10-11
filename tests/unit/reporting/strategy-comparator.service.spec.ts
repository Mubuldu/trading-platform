import { StrategyComparatorService } from '@modules/reporting/application/services/strategy-comparator.service';
import { StrategySnapshotNotFoundError } from '@modules/reporting/domain/errors/reporting.errors';
import { AnalyticsStorageService } from '@modules/analytics/storage/analytics-storage.service';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeSnapshot(
  strategyId: string,
  overrides: {
    totalReturnPercent?: number;
    sharpeRatio?: number;
    sortinoRatio?: number;
    calmarRatio?: number;
    maxDrawdown?: number;
    expectancy?: number;
    profitFactor?: number;
    totalTrades?: number;
    winningPercent?: number;
    netProfit?: number;
    annualizedReturnPercent?: number;
  } = {},
): AnalyticsSnapshot {
  return {
    snapshotId: `snap-${strategyId}`,
    sessionId: 'default',
    strategyId,
    computedAt: Date.now(),
    dataStartTime: 0,
    dataEndTime: 0,
    totalFillsProcessed: 0,
    totalDailyRecordsUsed: 0,
    performance: {
      initialCapital: 10_000,
      finalEquity: 10_000 + (overrides.netProfit ?? 0),
      netProfit: overrides.netProfit ?? 0,
      grossProfit: 0,
      grossLoss: 0,
      totalReturnPercent: overrides.totalReturnPercent ?? 0,
      annualizedReturnPercent: overrides.annualizedReturnPercent ?? 0,
      averageTrade: 0,
      medianTrade: 0,
      largestWin: 0,
      largestLoss: 0,
      averageWin: 0,
      averageLoss: 0,
      totalTrades: overrides.totalTrades ?? 0,
      winningTrades: 0,
      losingTrades: 0,
      breakEvenTrades: 0,
      winningPercent: overrides.winningPercent ?? 0,
      losingPercent: 0,
      expectancy: overrides.expectancy ?? 0,
      profitFactor: overrides.profitFactor ?? 1,
      recoveryFactor: 0,
      payoffRatio: 0,
      riskRewardRatio: 0,
      computedAt: Date.now(),
    },
    riskMetrics: {
      sharpeRatio: overrides.sharpeRatio ?? 0,
      rollingSharpe7d: 0,
      rollingSharpe30d: 0,
      rollingSharpe90d: 0,
      sortinoRatio: overrides.sortinoRatio ?? 0,
      rollingSortino7d: 0,
      rollingSortino30d: 0,
      rollingSortino90d: 0,
      calmarRatio: overrides.calmarRatio ?? 0,
      omegaRatio: 0,
      treynorRatio: 0,
      informationRatio: 0,
      maxDrawdown: overrides.maxDrawdown ?? 0,
      maxDrawdownAbsolute: 0,
      averageDrawdown: 0,
      ulcerIndex: 0,
      painIndex: 0,
      computedAt: Date.now(),
    },
    tradeMetrics: {
      averageHoldingTimeMs: 0,
      maxHoldingTimeMs: 0,
      minHoldingTimeMs: 0,
      averageBarsHeld: 0,
      maxBarsHeld: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      longestFlatPeriodMs: 0,
      tradeFrequencyPerDay: 0,
      tradeFrequencyPerWeek: 0,
      firstTradeAt: 0,
      lastTradeAt: 0,
      totalPeriodMs: 0,
      computedAt: Date.now(),
    },
    exposureMetrics: {
      grossExposure: 0,
      netExposure: 0,
      longExposure: 0,
      shortExposure: 0,
      bySymbol: {},
      byStrategy: {},
      byExchange: {},
      longPositionCount: 0,
      shortPositionCount: 0,
      totalPositionCount: 0,
      snapshotAt: Date.now(),
    },
    executionAnalytics: {
      averageSlippage: 0,
      medianSlippage: 0,
      worstSlippage: 0,
      totalSlippage: 0,
      averageLatencyMs: 0,
      medianLatencyMs: 0,
      p95LatencyMs: 0,
      maxLatencyMs: 0,
      orderFillRate: 1,
      cancelRate: 0,
      partialFillRate: 0,
      rejectedOrderRate: 0,
      totalFills: 0,
      totalCommission: 0,
      computedAt: Date.now(),
    },
    capitalMetrics: {
      equityCurve: [],
      balanceCurve: [],
      currentEquity: 10_000,
      currentBalance: 10_000,
      buyingPower: 10_000,
      marginUsed: 0,
      marginUtilizationPercent: 0,
      leverageUtilization: 0,
      cashUtilizationPercent: 0,
      snapshotAt: Date.now(),
    },
    rollingMetrics: {
      sevenDay: {
        window: 7,
        windowDays: 7,
        startDate: '',
        endDate: '',
        totalReturnPercent: 0,
        annualizedReturnPercent: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        maxDrawdown: 0,
        averageDrawdown: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        netProfit: 0,
        dailyVolatility: 0,
        annualizedVolatility: 0,
        computedAt: 0,
      },
      thirtyDay: {
        window: 30,
        windowDays: 30,
        startDate: '',
        endDate: '',
        totalReturnPercent: 0,
        annualizedReturnPercent: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        maxDrawdown: 0,
        averageDrawdown: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        netProfit: 0,
        dailyVolatility: 0,
        annualizedVolatility: 0,
        computedAt: 0,
      },
      ninetyDay: {
        window: 90,
        windowDays: 90,
        startDate: '',
        endDate: '',
        totalReturnPercent: 0,
        annualizedReturnPercent: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        maxDrawdown: 0,
        averageDrawdown: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        netProfit: 0,
        dailyVolatility: 0,
        annualizedVolatility: 0,
        computedAt: 0,
      },
      oneEightyDay: {
        window: 180,
        windowDays: 180,
        startDate: '',
        endDate: '',
        totalReturnPercent: 0,
        annualizedReturnPercent: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        maxDrawdown: 0,
        averageDrawdown: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        netProfit: 0,
        dailyVolatility: 0,
        annualizedVolatility: 0,
        computedAt: 0,
      },
      threeSixtyFiveDay: {
        window: 365,
        windowDays: 365,
        startDate: '',
        endDate: '',
        totalReturnPercent: 0,
        annualizedReturnPercent: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        maxDrawdown: 0,
        averageDrawdown: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        netProfit: 0,
        dailyVolatility: 0,
        annualizedVolatility: 0,
        computedAt: 0,
      },
      computedAt: Date.now(),
    },
    benchmarkComparisons: [],
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('StrategyComparatorService', () => {
  let service: StrategyComparatorService;
  let mockStorage: jest.Mocked<AnalyticsStorageService>;

  beforeEach(() => {
    mockStorage = {
      loadSnapshots: jest.fn().mockResolvedValue([]),
    } as any;

    service = new StrategyComparatorService(mockStorage);
  });

  describe('compare()', () => {
    it('throws when fewer than 2 strategy IDs are given', async () => {
      await expect(service.compare(['strat-A'], [])).rejects.toThrow('at least 2 strategy IDs');
    });

    it('returns one row per strategy', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { totalReturnPercent: 10, sharpeRatio: 1.5 }),
        makeSnapshot('strat-B', { totalReturnPercent: 5, sharpeRatio: 0.8 }),
      ];
      const result = await service.compare(['strat-A', 'strat-B'], snapshots);
      expect(result.strategies).toHaveLength(2);
    });

    it('identifies the best strategy by return', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { totalReturnPercent: 20 }),
        makeSnapshot('strat-B', { totalReturnPercent: 10 }),
      ];
      const result = await service.compare(['strat-A', 'strat-B'], snapshots);
      expect(result.bestByReturn).toBe('strat-A');
    });

    it('identifies the best strategy by Sharpe', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { sharpeRatio: 0.5 }),
        makeSnapshot('strat-B', { sharpeRatio: 2.1 }),
      ];
      const result = await service.compare(['strat-A', 'strat-B'], snapshots);
      expect(result.bestBySharpe).toBe('strat-B');
    });

    it('identifies the best strategy by drawdown (lowest wins)', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { maxDrawdown: 0.25 }),
        makeSnapshot('strat-B', { maxDrawdown: 0.08 }),
      ];
      const result = await service.compare(['strat-A', 'strat-B'], snapshots);
      expect(result.bestByDrawdown).toBe('strat-B');
    });

    it('identifies the best strategy by expectancy', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { expectancy: 50 }),
        makeSnapshot('strat-B', { expectancy: 120 }),
      ];
      const result = await service.compare(['strat-A', 'strat-B'], snapshots);
      expect(result.bestByExpectancy).toBe('strat-B');
    });

    it('identifies the best strategy by profit factor', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { profitFactor: 1.2 }),
        makeSnapshot('strat-B', { profitFactor: 2.5 }),
        makeSnapshot('strat-C', { profitFactor: 1.8 }),
      ];
      const result = await service.compare(['strat-A', 'strat-B', 'strat-C'], snapshots);
      expect(result.bestByProfitFactor).toBe('strat-B');
    });

    it('throws StrategySnapshotNotFoundError when snapshot is missing', async () => {
      const snapshots = [makeSnapshot('strat-A')];
      await expect(service.compare(['strat-A', 'strat-MISSING'], snapshots)).rejects.toThrow(
        StrategySnapshotNotFoundError,
      );
    });

    it('falls back to storage when no snapshots provided', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { totalReturnPercent: 10 }),
        makeSnapshot('strat-B', { totalReturnPercent: 5 }),
      ];
      mockStorage.loadSnapshots.mockResolvedValueOnce(snapshots);
      const result = await service.compare(['strat-A', 'strat-B'], []);
      expect(mockStorage.loadSnapshots).toHaveBeenCalledWith(500);
      expect(result.strategies).toHaveLength(2);
    });

    it('picks the most recent snapshot when multiple exist for a strategy', async () => {
      const older = makeSnapshot('strat-A', { totalReturnPercent: 5 });
      const newer = {
        ...makeSnapshot('strat-A', { totalReturnPercent: 20 }),
        computedAt: Date.now() + 10_000,
      };
      const snapB = makeSnapshot('strat-B');
      const result = await service.compare(['strat-A', 'strat-B'], [older, newer, snapB]);
      const rowA = result.strategies.find((r) => r.strategyId === 'strat-A')!;
      expect(rowA.totalReturnPercent).toBe(20);
    });

    it('handles 3 strategies correctly', async () => {
      const snapshots = [
        makeSnapshot('strat-A', { totalReturnPercent: 30, sharpeRatio: 2.0 }),
        makeSnapshot('strat-B', { totalReturnPercent: 15, sharpeRatio: 1.5 }),
        makeSnapshot('strat-C', { totalReturnPercent: 20, sharpeRatio: 1.8 }),
      ];
      const result = await service.compare(['strat-A', 'strat-B', 'strat-C'], snapshots);
      expect(result.strategies).toHaveLength(3);
      expect(result.bestByReturn).toBe('strat-A');
      expect(result.bestBySharpe).toBe('strat-A');
    });

    it('all best-by fields are valid strategy IDs', async () => {
      const ids = ['strat-A', 'strat-B'];
      const snapshots = ids.map((id) => makeSnapshot(id));
      const result = await service.compare(ids, snapshots);

      const validIds = new Set(ids);
      expect(validIds.has(result.bestByReturn)).toBe(true);
      expect(validIds.has(result.bestBySharpe)).toBe(true);
      expect(validIds.has(result.bestBySortino)).toBe(true);
      expect(validIds.has(result.bestByCalmar)).toBe(true);
      expect(validIds.has(result.bestByDrawdown)).toBe(true);
      expect(validIds.has(result.bestByExpectancy)).toBe(true);
      expect(validIds.has(result.bestByProfitFactor)).toBe(true);
    });
  });
});
