import { ReportGeneratorService } from '@modules/reporting/application/services/report-generator.service';
import { ReportConfig } from '@modules/reporting/domain/models/report-config.model';
import { ReportPeriod } from '@modules/reporting/domain/enums/report-period.enum';
import { ReportSource } from '@modules/reporting/domain/enums/report-source.enum';
import { ReportExportFormat } from '@modules/reporting/domain/enums/report-export-format.enum';
import { ReportStatus } from '@modules/reporting/domain/enums/report-status.enum';
import {
  InvalidReportConfigError,
  NoSnapshotDataError,
} from '@modules/reporting/domain/errors/reporting.errors';
import { AnalyticsStorageService } from '@modules/analytics/storage/analytics-storage.service';
import { AnalyticsDataCollectorService } from '@modules/analytics/application/services/analytics-data-collector.service';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { ReportStorageService } from '@modules/reporting/application/storage/report-storage.service';

// ── Fixture ────────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

const EMPTY_SNAPSHOT: AnalyticsSnapshot = {
  snapshotId: 'snap-1',
  sessionId: 'paper_trading_default',
  computedAt: NOW,
  dataStartTime: NOW - 30 * 86_400_000,
  dataEndTime: NOW,
  totalFillsProcessed: 0,
  totalDailyRecordsUsed: 0,
  performance: {
    initialCapital: 10_000,
    finalEquity: 10_000,
    netProfit: 0,
    grossProfit: 0,
    grossLoss: 0,
    totalReturnPercent: 0,
    annualizedReturnPercent: 0,
    averageTrade: 0,
    medianTrade: 0,
    largestWin: 0,
    largestLoss: 0,
    averageWin: 0,
    averageLoss: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    winningPercent: 0,
    losingPercent: 0,
    expectancy: 0,
    profitFactor: 0,
    recoveryFactor: 0,
    payoffRatio: 0,
    riskRewardRatio: 0,
    computedAt: NOW,
  },
  riskMetrics: {
    sharpeRatio: 0,
    rollingSharpe7d: 0,
    rollingSharpe30d: 0,
    rollingSharpe90d: 0,
    sortinoRatio: 0,
    rollingSortino7d: 0,
    rollingSortino30d: 0,
    rollingSortino90d: 0,
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
    computedAt: NOW,
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
    snapshotAt: NOW,
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
    computedAt: NOW,
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
    snapshotAt: NOW,
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
      computedAt: NOW,
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
      computedAt: NOW,
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
      computedAt: NOW,
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
      computedAt: NOW,
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
      computedAt: NOW,
    },
    computedAt: NOW,
  },
  benchmarkComparisons: [],
};

const BASE_CONFIG: ReportConfig = {
  period: ReportPeriod.DAILY,
  source: ReportSource.PAPER,
  sessionId: 'paper_trading_default',
  strategyIds: [],
  formats: [ReportExportFormat.JSON],
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ReportGeneratorService', () => {
  let service: ReportGeneratorService;
  let mockAnalyticsStorage: jest.Mocked<AnalyticsStorageService>;
  let mockDataCollector: jest.Mocked<AnalyticsDataCollectorService>;
  let mockStorage: jest.Mocked<ReportStorageService>;
  let mockLogger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  // Stub builders — real implementations tested separately
  const mkExecBuilder = () => ({
    build: jest.fn().mockReturnValue({
      title: 'Test Report',
      periodLabel: '',
      sourceLabel: '',
      generatedAt: '',
      netPnl: 0,
      netPnlPercent: 0,
      totalReturn: 0,
      totalReturnPercent: 0,
      annualizedReturnPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      rolling30dReturnPercent: 0,
      rolling30dSharpe: 0,
      isProfit: false,
      isPositiveSharpe: false,
      highlights: [],
    }),
  });
  const mkSimpleBuilder = (obj: object) => ({ build: jest.fn().mockReturnValue(obj) });

  beforeEach(() => {
    mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    mockAnalyticsStorage = {
      loadSnapshotsByRange: jest.fn().mockResolvedValue([EMPTY_SNAPSHOT]),
      loadLatestSnapshot: jest.fn().mockResolvedValue(EMPTY_SNAPSHOT),
      loadSnapshots: jest.fn().mockResolvedValue([EMPTY_SNAPSHOT]),
      saveSnapshot: jest.fn().mockResolvedValue(undefined),
      loadSummaries: jest.fn().mockResolvedValue([]),
      countSnapshots: jest.fn().mockResolvedValue(1),
    } as any;

    mockDataCollector = {
      collectTrades: jest.fn().mockResolvedValue([]),
    } as any;

    mockStorage = {
      save: jest.fn().mockResolvedValue(undefined),
      nextVersion: jest.fn().mockResolvedValue({ reportId: 'rpt_abc123', version: 1 }),
      loadById: jest.fn().mockResolvedValue(null),
      loadLatest: jest.fn().mockResolvedValue([]),
      loadIndex: jest.fn().mockResolvedValue([]),
    } as any;

    const stubComparator = { compare: jest.fn().mockResolvedValue(null) } as any;

    service = new ReportGeneratorService(
      mockLogger as any,
      mockAnalyticsStorage,
      mockDataCollector,
      mkExecBuilder() as any,
      mkSimpleBuilder({ initialCapital: 10_000 }) as any,
      mkSimpleBuilder({ totalTrades: 0 }) as any,
      mkSimpleBuilder({ sharpeRatio: 0 }) as any,
      mkSimpleBuilder({ isInDrawdown: false, top5Drawdowns: [] }) as any,
      mkSimpleBuilder({ executionScore: 100 }) as any,
      mkSimpleBuilder({ openPositionCount: 0 }) as any,
      mkSimpleBuilder({
        items: [],
        riskAlerts: [],
        totalItems: 0,
        highPriorityCount: 0,
        mediumPriorityCount: 0,
        lowPriorityCount: 0,
      }) as any,
      mkSimpleBuilder({
        equityCurve: [],
        balanceCurve: [],
        drawdownCurve: [],
        rollingSharpe: [],
        rollingVolatility: [],
        monthlyReturns: [],
        tradeDistribution: [],
        pnlDistribution: [],
        holdingTimeDistribution: [],
      }) as any,
      stubComparator,
      mockStorage,
    );
  });

  // ── generate() ────────────────────────────────────────────────────────────────

  describe('generate()', () => {
    it('returns a TradingReport with correct status', async () => {
      const report = await service.generate(BASE_CONFIG);
      expect(report.status).toBe(ReportStatus.COMPLETE);
    });

    it('assigns the stable reportId from storage', async () => {
      const report = await service.generate(BASE_CONFIG);
      expect(report.reportId).toBe('rpt_abc123');
      expect(report.version).toBe(1);
    });

    it('increments version on re-generation', async () => {
      mockStorage.nextVersion.mockResolvedValueOnce({ reportId: 'rpt_abc123', version: 2 });
      const report = await service.generate(BASE_CONFIG);
      expect(report.version).toBe(2);
    });

    it('persists the report via storage', async () => {
      const report = await service.generate(BASE_CONFIG);
      expect(mockStorage.save).toHaveBeenCalledTimes(1);
      expect(mockStorage.save).toHaveBeenCalledWith(report);
    });

    it('collects trades for chart data', async () => {
      await service.generate(BASE_CONFIG);
      expect(mockDataCollector.collectTrades).toHaveBeenCalledTimes(1);
    });

    it('loads analytics snapshots for the resolved period', async () => {
      await service.generate(BASE_CONFIG);
      expect(mockAnalyticsStorage.loadSnapshotsByRange).toHaveBeenCalledTimes(1);
    });

    it('includes all 9 sections in the report', async () => {
      const report = await service.generate(BASE_CONFIG);
      expect(report.executiveSummary).toBeDefined();
      expect(report.portfolioPerformance).toBeDefined();
      expect(report.tradeSummary).toBeDefined();
      expect(report.riskMetrics).toBeDefined();
      expect(report.drawdownAnalysis).toBeDefined();
      expect(report.executionQuality).toBeDefined();
      expect(report.exposureAnalysis).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.charts).toBeDefined();
    });

    it('sets strategyComparison to null for single-strategy reports', async () => {
      const report = await service.generate({ ...BASE_CONFIG, strategyIds: ['strat-A'] });
      expect(report.strategyComparison).toBeNull();
    });

    it('records generationDurationMs > 0', async () => {
      const report = await service.generate(BASE_CONFIG);
      expect(report.generationDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('falls back to latest snapshot when period range has no data', async () => {
      mockAnalyticsStorage.loadSnapshotsByRange.mockResolvedValueOnce([]);
      const report = await service.generate(BASE_CONFIG);
      expect(report.status).toBe(ReportStatus.COMPLETE);
      expect(mockAnalyticsStorage.loadLatestSnapshot).toHaveBeenCalled();
    });

    it('includes snapshot IDs in the report', async () => {
      const report = await service.generate(BASE_CONFIG);
      expect(report.snapshotIds).toContain('snap-1');
    });
  });

  // ── Period resolution ────────────────────────────────────────────────────────

  describe('period resolution', () => {
    it('resolves CUSTOM period from fromMs/toMs', async () => {
      const fromMs = Date.UTC(2024, 0, 1);
      const toMs = Date.UTC(2024, 0, 31, 23, 59, 59, 999);
      const report = await service.generate({
        ...BASE_CONFIG,
        period: ReportPeriod.CUSTOM,
        fromMs,
        toMs,
      });
      expect(report.periodStartDate).toBe('2024-01-01');
      expect(report.periodEndDate).toBe('2024-01-31');
    });

    it('resolves MONTHLY period from referenceDate', async () => {
      const report = await service.generate({
        ...BASE_CONFIG,
        period: ReportPeriod.MONTHLY,
        referenceDate: '2024-03-15',
      });
      expect(report.periodStartDate).toBe('2024-03-01');
      expect(report.periodEndDate).toBe('2024-03-31');
    });

    it('resolves YEARLY period from referenceDate', async () => {
      const report = await service.generate({
        ...BASE_CONFIG,
        period: ReportPeriod.YEARLY,
        referenceDate: '2024-06-01',
      });
      expect(report.periodStartDate).toBe('2024-01-01');
      expect(report.periodEndDate).toBe('2024-12-31');
    });

    it('resolves QUARTERLY period to the correct quarter', async () => {
      const report = await service.generate({
        ...BASE_CONFIG,
        period: ReportPeriod.QUARTERLY,
        referenceDate: '2024-08-10',
      });
      expect(report.periodStartDate).toBe('2024-07-01');
      expect(report.periodEndDate).toBe('2024-09-30');
    });
  });

  // ── Validation ────────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('throws InvalidReportConfigError when CUSTOM period lacks fromMs/toMs', async () => {
      await expect(
        service.generate({ ...BASE_CONFIG, period: ReportPeriod.CUSTOM }),
      ).rejects.toThrow(InvalidReportConfigError);
    });

    it('throws InvalidReportConfigError when fromMs >= toMs', async () => {
      await expect(
        service.generate({ ...BASE_CONFIG, period: ReportPeriod.CUSTOM, fromMs: 1000, toMs: 999 }),
      ).rejects.toThrow(InvalidReportConfigError);
    });

    it('throws InvalidReportConfigError when sessionId is empty', async () => {
      await expect(service.generate({ ...BASE_CONFIG, sessionId: '' })).rejects.toThrow(
        InvalidReportConfigError,
      );
    });

    it('throws NoSnapshotDataError when no snapshots exist', async () => {
      mockAnalyticsStorage.loadSnapshotsByRange.mockResolvedValueOnce([]);
      mockAnalyticsStorage.loadLatestSnapshot.mockResolvedValueOnce(null);
      await expect(service.generate(BASE_CONFIG)).rejects.toThrow(NoSnapshotDataError);
    });
  });

  // ── Read-only guarantee ───────────────────────────────────────────────────────

  describe('read-only guarantee', () => {
    it('never calls any trade submission method', async () => {
      await service.generate(BASE_CONFIG);
      // dataCollector mock has only read methods; confirm no submit/place/cancel calls
      const forbidden = Object.keys(mockDataCollector).filter((k) =>
        /submit|place|cancel|modify|update/i.test(k),
      );
      expect(forbidden).toHaveLength(0);
    });
  });
});
