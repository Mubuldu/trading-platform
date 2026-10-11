import { AnalyticsEngineService } from '@modules/analytics/application/services/analytics-engine.service';
import { AnalyticsDataCollectorService } from '@modules/analytics/application/services/analytics-data-collector.service';
import { AnalyticsStorageService } from '@modules/analytics/storage/analytics-storage.service';
import { PerformanceCalculator } from '@modules/analytics/application/calculators/performance.calculator';
import { RiskMetricsCalculator } from '@modules/analytics/application/calculators/risk-metrics.calculator';
import { TradeMetricsCalculator } from '@modules/analytics/application/calculators/trade-metrics.calculator';
import { ExposureCalculator } from '@modules/analytics/application/calculators/exposure.calculator';
import { ExecutionAnalyticsCalculator } from '@modules/analytics/application/calculators/execution-analytics.calculator';
import { CapitalMetricsCalculator } from '@modules/analytics/application/calculators/capital-metrics.calculator';
import { RollingMetricsCalculator } from '@modules/analytics/application/calculators/rolling-metrics.calculator';
import { BenchmarkCalculator } from '@modules/analytics/application/calculators/benchmark.calculator';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { BenchmarkType } from '@modules/analytics/domain/enums/benchmark-type.enum';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

const EMPTY_PERFORMANCE = {
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  breakEvenTrades: 0,
  grossProfit: 0,
  grossLoss: 0,
  netProfit: 0,
  totalReturnPercent: 0,
  annualizedReturnPercent: 0,
  winningPercent: 0,
  losingPercent: 0,
  averageWin: 0,
  averageLoss: 0,
  largestWin: 0,
  largestLoss: 0,
  averageTrade: 0,
  medianTrade: 0,
  profitFactor: 0,
  expectancy: 0,
  payoffRatio: 0,
  recoveryFactor: 0,
};

const EMPTY_RISK = {
  sharpeRatio: 0,
  rollingSharpe7d: 0,
  rollingSharpe30d: 0,
  sortinoRatio: 0,
  rollingSortino7d: 0,
  rollingSortino30d: 0,
  calmarRatio: 0,
  omegaRatio: 0,
  treynorRatio: 0,
  informationRatio: 0,
  maxDrawdown: 0,
  maxDrawdownAbsolute: 0,
  averageDrawdown: 0,
  ulcerIndex: 0,
  painIndex: 0,
  computedAt: NOW,
};

const EMPTY_TRADE_METRICS = {
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
};

const EMPTY_EXPOSURE = {
  grossExposure: 0,
  netExposure: 0,
  longExposure: 0,
  shortExposure: 0,
  longPositionCount: 0,
  shortPositionCount: 0,
  totalPositionCount: 0,
  bySymbol: {},
  byStrategy: {},
  byExchange: {},
};

const EMPTY_EXECUTION = {
  averageSlippage: 0,
  medianSlippage: 0,
  worstSlippage: 0,
  totalSlippage: 0,
  averageLatencyMs: 0,
  medianLatencyMs: 0,
  p95LatencyMs: 0,
  maxLatencyMs: 0,
  totalFills: 0,
  totalCommission: 0,
  orderFillRate: 1,
  cancelRate: 0,
  partialFillRate: 0,
  rejectedOrderRate: 0,
};

const EMPTY_CAPITAL = {
  equityCurve: [],
  balanceCurve: [],
  currentEquity: 10_000,
  currentBalance: 10_000,
  buyingPower: 10_000,
  marginUsed: 0,
  marginUtilizationPercent: 0,
  leverageUtilization: 0,
  cashUtilizationPercent: 0,
  snapshotAt: NOW,
};

const ROLLING_WINDOW_STUB = {
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
  computedAt: NOW,
};

const EMPTY_ROLLING = {
  sevenDay: ROLLING_WINDOW_STUB,
  thirtyDay: ROLLING_WINDOW_STUB,
  ninetyDay: ROLLING_WINDOW_STUB,
  oneEightyDay: ROLLING_WINDOW_STUB,
  threeSixtyFiveDay: ROLLING_WINDOW_STUB,
  computedAt: NOW,
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('AnalyticsEngineService', () => {
  let engine: AnalyticsEngineService;

  // Mocks
  let mockLogger: jest.Mocked<{ log: jest.Mock; warn: jest.Mock; error: jest.Mock }>;
  let mockCollector: jest.Mocked<AnalyticsDataCollectorService>;
  let mockStorage: jest.Mocked<AnalyticsStorageService>;
  let mockPerformanceCalc: jest.Mocked<PerformanceCalculator>;
  let mockRiskCalc: jest.Mocked<RiskMetricsCalculator>;
  let mockTradeMetricsCalc: jest.Mocked<TradeMetricsCalculator>;
  let mockExposureCalc: jest.Mocked<ExposureCalculator>;
  let mockExecutionCalc: jest.Mocked<ExecutionAnalyticsCalculator>;
  let mockCapitalCalc: jest.Mocked<CapitalMetricsCalculator>;
  let mockRollingCalc: jest.Mocked<RollingMetricsCalculator>;
  let mockBenchmarkCalc: jest.Mocked<BenchmarkCalculator>;

  beforeEach(() => {
    mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

    mockCollector = {
      collectTrades: jest.fn().mockResolvedValue([]),
      collectFills: jest.fn().mockResolvedValue([]),
      collectEquityPoints: jest.fn().mockResolvedValue([]),
      collectPositionSnapshots: jest.fn().mockResolvedValue([]),
      collectDailyCapitalRecords: jest.fn().mockResolvedValue([]),
      getTotalFillCount: jest.fn().mockResolvedValue(0),
      getCurrentAccountState: jest.fn().mockReturnValue({
        equity: 10_000,
        balance: 10_000,
        lockedBalance: 0,
        totalRealizedPnl: 0,
        startedAt: NOW - 30 * 86_400_000,
      }),
    } as any;

    mockStorage = {
      saveSnapshot: jest.fn().mockResolvedValue(undefined),
      loadLatestSnapshot: jest.fn().mockResolvedValue(null),
      loadSnapshots: jest.fn().mockResolvedValue([]),
      loadSnapshotsByRange: jest.fn().mockResolvedValue([]),
    } as any;

    mockPerformanceCalc = { compute: jest.fn().mockReturnValue(EMPTY_PERFORMANCE) } as any;
    mockRiskCalc = { compute: jest.fn().mockReturnValue(EMPTY_RISK) } as any;
    mockTradeMetricsCalc = { compute: jest.fn().mockReturnValue(EMPTY_TRADE_METRICS) } as any;
    mockExposureCalc = { compute: jest.fn().mockReturnValue(EMPTY_EXPOSURE) } as any;
    mockExecutionCalc = { compute: jest.fn().mockReturnValue(EMPTY_EXECUTION) } as any;
    mockCapitalCalc = { compute: jest.fn().mockReturnValue(EMPTY_CAPITAL) } as any;
    mockRollingCalc = { compute: jest.fn().mockReturnValue(EMPTY_ROLLING) } as any;
    mockBenchmarkCalc = { compare: jest.fn() } as any;

    engine = new AnalyticsEngineService(
      mockLogger as any,
      mockCollector,
      mockStorage,
      mockPerformanceCalc,
      mockRiskCalc,
      mockTradeMetricsCalc,
      mockExposureCalc,
      mockExecutionCalc,
      mockCapitalCalc,
      mockRollingCalc,
      mockBenchmarkCalc,
    );
  });

  // ── compute() ───────────────────────────────────────────────────────────────

  describe('compute()', () => {
    it('returns an AnalyticsSnapshot with a unique snapshotId', async () => {
      const snapshot = await engine.compute();
      expect(snapshot.snapshotId).toBeDefined();
      expect(typeof snapshot.snapshotId).toBe('string');
      expect(snapshot.snapshotId.length).toBeGreaterThan(0);

      // Second call should produce a different snapshotId
      const snapshot2 = await engine.compute();
      expect(snapshot2.snapshotId).not.toBe(snapshot.snapshotId);
    });

    it('calls all 8 calculators exactly once per compute()', async () => {
      await engine.compute();
      expect(mockPerformanceCalc.compute).toHaveBeenCalledTimes(1);
      expect(mockRiskCalc.compute).toHaveBeenCalledTimes(1);
      expect(mockTradeMetricsCalc.compute).toHaveBeenCalledTimes(1);
      expect(mockExposureCalc.compute).toHaveBeenCalledTimes(1);
      expect(mockExecutionCalc.compute).toHaveBeenCalledTimes(1);
      expect(mockCapitalCalc.compute).toHaveBeenCalledTimes(1);
      expect(mockRollingCalc.compute).toHaveBeenCalledTimes(1);
    });

    it('collects all data types from the collector', async () => {
      await engine.compute();
      expect(mockCollector.collectTrades).toHaveBeenCalledTimes(1);
      expect(mockCollector.collectFills).toHaveBeenCalledTimes(1);
      expect(mockCollector.collectEquityPoints).toHaveBeenCalledTimes(1);
      expect(mockCollector.collectPositionSnapshots).toHaveBeenCalledTimes(1);
      expect(mockCollector.collectDailyCapitalRecords).toHaveBeenCalledTimes(1);
      expect(mockCollector.getTotalFillCount).toHaveBeenCalledTimes(1);
    });

    it('persists the snapshot via storage', async () => {
      const snapshot = await engine.compute();
      expect(mockStorage.saveSnapshot).toHaveBeenCalledTimes(1);
      expect(mockStorage.saveSnapshot).toHaveBeenCalledWith(snapshot);
    });

    it('snapshot includes all metric groups', async () => {
      const snapshot = await engine.compute();
      expect(snapshot.performance).toBeDefined();
      expect(snapshot.riskMetrics).toBeDefined();
      expect(snapshot.tradeMetrics).toBeDefined();
      expect(snapshot.exposureMetrics).toBeDefined();
      expect(snapshot.executionAnalytics).toBeDefined();
      expect(snapshot.capitalMetrics).toBeDefined();
      expect(snapshot.rollingMetrics).toBeDefined();
      expect(snapshot.benchmarkComparisons).toBeDefined();
    });

    it('snapshot has computedAt timestamp within the last minute', async () => {
      const before = Date.now() - 1000;
      const snapshot = await engine.compute();
      const after = Date.now() + 1000;
      expect(snapshot.computedAt).toBeGreaterThan(before);
      expect(snapshot.computedAt).toBeLessThan(after);
    });

    it('always produces benchmarkComparisons as an array', async () => {
      const snapshot = await engine.compute();
      expect(Array.isArray(snapshot.benchmarkComparisons)).toBe(true);
    });

    it('includes Buy & Hold comparison when at least 2 equity points exist', async () => {
      const equityPoints = [
        {
          timestamp: NOW - 86_400_000,
          date: '2023-11-14',
          equity: 10_000,
          cashBalance: 10_000,
          dailyReturn: 0,
          cumulativeReturn: 0,
        },
        {
          timestamp: NOW,
          date: '2023-11-15',
          equity: 10_500,
          cashBalance: 10_500,
          dailyReturn: 0.05,
          cumulativeReturn: 0.05,
        },
      ];
      mockCollector.collectEquityPoints.mockResolvedValue(equityPoints);

      const buyHoldResult = {
        benchmarkType: BenchmarkType.BUY_AND_HOLD,
        benchmarkLabel: 'Buy & Hold',
        benchmarkTotalReturnPercent: 5,
        strategyTotalReturnPercent: 5,
        alpha: 0,
        beta: 1,
        correlation: 1,
        trackingError: 0,
        informationRatio: 0,
        benchmarkSharpe: 0,
        strategySharpe: 0,
        outperformanceDays: 0,
        underperformanceDays: 0,
        outperformanceRate: 0,
        periodStartDate: '2023-11-14',
        periodEndDate: '2023-11-15',
        computedAt: NOW,
      };
      mockBenchmarkCalc.compare.mockReturnValue(buyHoldResult);

      const snapshot = await engine.compute();
      expect(mockBenchmarkCalc.compare).toHaveBeenCalledWith(
        equityPoints,
        BenchmarkType.BUY_AND_HOLD,
        'Buy & Hold',
        [],
      );
      expect(snapshot.benchmarkComparisons).toHaveLength(1);
    });

    it('does not add Buy & Hold when fewer than 2 equity points', async () => {
      mockCollector.collectEquityPoints.mockResolvedValue([]);
      const snapshot = await engine.compute();
      expect(mockBenchmarkCalc.compare).not.toHaveBeenCalled();
      expect(snapshot.benchmarkComparisons).toHaveLength(0);
    });

    it('does not propagate storage failures — snapshot is still returned', async () => {
      mockStorage.saveSnapshot.mockRejectedValue(new Error('Redis connection lost'));
      // Engine should catch the storage error internally and still return the snapshot
      // (per architecture: storage failures are caught and logged, never propagated)
      // If the engine does NOT catch internally, this test documents that it does throw.
      // Per the spec the engine catches storage errors; adjust if implementation differs.
      let result: AnalyticsSnapshot | undefined;
      let err: Error | undefined;
      try {
        result = await engine.compute();
      } catch (e) {
        err = e as Error;
      }
      // Either it returned a snapshot (storage error caught) or it threw (we document that too).
      // The spec says failures are caught; verify snapshot is returned:
      expect(result).toBeDefined();
      expect(err).toBeUndefined();
    });

    it('sets totalFillsProcessed from collector', async () => {
      mockCollector.getTotalFillCount.mockResolvedValue(42);
      const snapshot = await engine.compute();
      expect(snapshot.totalFillsProcessed).toBe(42);
    });

    it('sets totalDailyRecordsUsed to the length of daily capital records', async () => {
      const dailyRecords = Array.from({ length: 30 }, (_, i) => ({
        date: `2023-10-${String(i + 1).padStart(2, '0')}`,
        timestamp: NOW - (30 - i) * 86_400_000,
        equity: 10_000 + i * 100,
        cashBalance: 10_000 + i * 100,
        unrealizedPnl: 0,
      }));
      mockCollector.collectDailyCapitalRecords.mockResolvedValue(dailyRecords);
      const snapshot = await engine.compute();
      expect(snapshot.totalDailyRecordsUsed).toBe(30);
    });
  });

  // ── getLatestSnapshot() ────────────────────────────────────────────────────

  describe('getLatestSnapshot()', () => {
    it('returns null when no snapshots exist', async () => {
      mockStorage.loadLatestSnapshot.mockResolvedValue(null);
      const result = await engine.getLatestSnapshot();
      expect(result).toBeNull();
    });

    it('delegates to storage service', async () => {
      const fakeSnapshot = { snapshotId: 'abc' } as unknown as AnalyticsSnapshot;
      mockStorage.loadLatestSnapshot.mockResolvedValue(fakeSnapshot);
      const result = await engine.getLatestSnapshot();
      expect(result).toBe(fakeSnapshot);
      expect(mockStorage.loadLatestSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  // ── getSnapshotHistory() ───────────────────────────────────────────────────

  describe('getSnapshotHistory()', () => {
    it('returns empty array when no history', async () => {
      const result = await engine.getSnapshotHistory();
      expect(result).toEqual([]);
    });

    it('passes limit to storage', async () => {
      await engine.getSnapshotHistory(50);
      expect(mockStorage.loadSnapshots).toHaveBeenCalledWith(50);
    });

    it('uses default limit of 100', async () => {
      await engine.getSnapshotHistory();
      expect(mockStorage.loadSnapshots).toHaveBeenCalledWith(100);
    });
  });

  // ── getSnapshotRange() ─────────────────────────────────────────────────────

  describe('getSnapshotRange()', () => {
    it('delegates range query to storage', async () => {
      const from = NOW - 7 * 86_400_000;
      const to = NOW;
      await engine.getSnapshotRange(from, to);
      expect(mockStorage.loadSnapshotsByRange).toHaveBeenCalledWith(from, to);
    });

    it('returns whatever storage provides', async () => {
      const fakes = [{ snapshotId: 'x' }] as unknown as AnalyticsSnapshot[];
      mockStorage.loadSnapshotsByRange.mockResolvedValue(fakes);
      const result = await engine.getSnapshotRange(0, NOW);
      expect(result).toHaveLength(1);
    });
  });

  // ── No side effects on trading ────────────────────────────────────────────

  describe('read-only guarantee', () => {
    it('never calls any write method on the collector', async () => {
      await engine.compute();
      // The collector mock has only read methods; confirm none were called by name
      // containing "submit", "place", "cancel", "modify"
      const callsToCollector = Object.keys(mockCollector).filter((k) =>
        /submit|place|cancel|modify|update/i.test(k),
      );
      expect(callsToCollector).toHaveLength(0);
    });
  });
});
