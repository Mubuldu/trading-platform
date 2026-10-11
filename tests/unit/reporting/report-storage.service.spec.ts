import { ReportStorageService } from '@modules/reporting/application/storage/report-storage.service';
import { TradingReport } from '@modules/reporting/domain/models/report.model';
import { ReportConfig } from '@modules/reporting/domain/models/report-config.model';
import { ReportPeriod } from '@modules/reporting/domain/enums/report-period.enum';
import { ReportSource } from '@modules/reporting/domain/enums/report-source.enum';
import { ReportStatus } from '@modules/reporting/domain/enums/report-status.enum';
import { ReportExportFormat } from '@modules/reporting/domain/enums/report-export-format.enum';

// ── Fixture ────────────────────────────────────────────────────────────────────

function makeReport(id = 'rpt_test', version = 1): TradingReport {
  return {
    reportId: id,
    version,
    generatedAt: Date.now(),
    title: `Test Report v${version}`,
    period: ReportPeriod.DAILY,
    source: ReportSource.PAPER,
    sessionId: 'default',
    strategyIds: [],
    periodStartDate: '2024-01-15',
    periodEndDate: '2024-01-15',
    periodStartMs: Date.UTC(2024, 0, 15),
    periodEndMs: Date.UTC(2024, 0, 15, 23, 59, 59, 999),
    snapshotIds: [],
    formats: [ReportExportFormat.JSON],
    status: ReportStatus.COMPLETE,
    generationDurationMs: 10,
    executiveSummary: {
      title: 'Test',
      periodLabel: '',
      sourceLabel: '',
      generatedAt: '',
      netPnl: 100,
      netPnlPercent: 1,
      totalReturn: 100,
      totalReturnPercent: 1,
      annualizedReturnPercent: 12,
      sharpeRatio: 1,
      sortinoRatio: 1.5,
      calmarRatio: 2,
      maxDrawdown: 0.05,
      maxDrawdownPercent: 5,
      totalTrades: 5,
      winRate: 0.6,
      profitFactor: 1.5,
      expectancy: 20,
      rolling30dReturnPercent: 3,
      rolling30dSharpe: 0.9,
      isProfit: true,
      isPositiveSharpe: true,
      highlights: [],
    },
    portfolioPerformance: {} as any,
    tradeSummary: {} as any,
    riskMetrics: {} as any,
    drawdownAnalysis: {} as any,
    strategyComparison: null,
    executionQuality: { executionScore: 90 } as any,
    exposureAnalysis: {} as any,
    recommendations: {
      items: [],
      riskAlerts: [],
      totalItems: 0,
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      lowPriorityCount: 0,
    },
    charts: {
      equityCurve: [],
      balanceCurve: [],
      drawdownCurve: [],
      rollingSharpe: [],
      rollingVolatility: [],
      monthlyReturns: [],
      tradeDistribution: [],
      pnlDistribution: [],
      holdingTimeDistribution: [],
    },
  };
}

const BASE_CONFIG: ReportConfig = {
  period: ReportPeriod.DAILY,
  source: ReportSource.PAPER,
  sessionId: 'default',
  strategyIds: [],
  formats: [ReportExportFormat.JSON],
  referenceDate: '2024-01-15',
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ReportStorageService', () => {
  let service: ReportStorageService;
  let mockRedis: {
    get: jest.Mock;
    set: jest.Mock;
    incr: jest.Mock;
    lpush: jest.Mock;
    ltrim: jest.Mock;
    lrange: jest.Mock;
  };
  let mockSortedSet: {
    add: jest.Mock;
    trimToMaxSize: jest.Mock;
    getLatest: jest.Mock;
    rangeByScore: jest.Mock;
    count: jest.Mock;
  };
  let mockLogger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock; debug?: jest.Mock };

  beforeEach(() => {
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      lpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      lrange: jest.fn().mockResolvedValue([]),
    };

    mockSortedSet = {
      add: jest.fn().mockResolvedValue(1),
      trimToMaxSize: jest.fn().mockResolvedValue(0),
      getLatest: jest.fn().mockResolvedValue([]),
      rangeByScore: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };

    mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    service = new ReportStorageService(
      { getClient: () => mockRedis } as any,
      mockSortedSet as any,
      mockLogger as any,
    );
  });

  // ── save() ────────────────────────────────────────────────────────────────────

  describe('save()', () => {
    it('stores the full report JSON', async () => {
      const report = makeReport();
      await service.save(report);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `reports:report:${report.reportId}`,
        JSON.stringify(report),
      );
    });

    it('stores a versioned snapshot', async () => {
      const report = makeReport('rpt_test', 3);
      await service.save(report);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `reports:versions:rpt_test:3`,
        JSON.stringify(report),
      );
    });

    it('registers the report in the sorted set', async () => {
      const report = makeReport();
      await service.save(report);
      expect(mockSortedSet.add).toHaveBeenCalledWith(
        'reports:all',
        report.generatedAt,
        report.reportId,
      );
    });

    it('updates the lightweight index', async () => {
      const report = makeReport();
      await service.save(report);
      expect(mockRedis.lpush).toHaveBeenCalledWith('reports:index', expect.any(String));
    });

    it('trims the index to MAX_REPORTS', async () => {
      await service.save(makeReport());
      expect(mockRedis.ltrim).toHaveBeenCalledWith('reports:index', 0, 364);
    });

    it('does not throw when Redis is unavailable', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis down'));
      await expect(service.save(makeReport())).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ── loadById() ────────────────────────────────────────────────────────────────

  describe('loadById()', () => {
    it('returns null when not found', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const result = await service.loadById('rpt_unknown');
      expect(result).toBeNull();
    });

    it('returns the parsed report when found', async () => {
      const report = makeReport();
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(report));
      const result = await service.loadById(report.reportId);
      expect(result).toEqual(report);
    });

    it('returns null and logs when Redis throws', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('connection reset'));
      const result = await service.loadById('rpt_test');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ── loadVersion() ─────────────────────────────────────────────────────────────

  describe('loadVersion()', () => {
    it('reads from the versioned key', async () => {
      const report = makeReport('rpt_test', 2);
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(report));
      const result = await service.loadVersion('rpt_test', 2);
      expect(mockRedis.get).toHaveBeenCalledWith('reports:versions:rpt_test:2');
      expect(result?.version).toBe(2);
    });

    it('returns null for a missing version', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const result = await service.loadVersion('rpt_test', 99);
      expect(result).toBeNull();
    });
  });

  // ── loadLatest() ──────────────────────────────────────────────────────────────

  describe('loadLatest()', () => {
    it('returns empty array when no reports exist', async () => {
      const result = await service.loadLatest();
      expect(result).toEqual([]);
    });

    it('uses the sorted set to discover report IDs', async () => {
      mockSortedSet.getLatest.mockResolvedValueOnce([{ value: 'rpt_test', score: 1 }]);
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(makeReport()));
      const result = await service.loadLatest(5);
      expect(mockSortedSet.getLatest).toHaveBeenCalledWith('reports:all', 5);
      expect(result).toHaveLength(1);
    });
  });

  // ── loadIndex() ───────────────────────────────────────────────────────────────

  describe('loadIndex()', () => {
    it('returns empty array when index is empty', async () => {
      const result = await service.loadIndex();
      expect(result).toEqual([]);
    });

    it('parses all summary entries from the index', async () => {
      const summary = { reportId: 'rpt_test', version: 1, generatedAt: Date.now(), title: 'Test' };
      mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(summary)]);
      const result = await service.loadIndex();
      expect(result).toHaveLength(1);
      expect(result[0]!.reportId).toBe('rpt_test');
    });
  });

  // ── countReports() ────────────────────────────────────────────────────────────

  describe('countReports()', () => {
    it('returns 0 when no reports', async () => {
      const count = await service.countReports();
      expect(count).toBe(0);
    });

    it('delegates to sorted set count', async () => {
      mockSortedSet.count.mockResolvedValueOnce(42);
      const count = await service.countReports();
      expect(count).toBe(42);
    });
  });

  // ── nextVersion() ─────────────────────────────────────────────────────────────

  describe('nextVersion()', () => {
    it('returns version 1 on first call', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);
      const result = await service.nextVersion(BASE_CONFIG);
      expect(result.version).toBe(1);
    });

    it('returns version 2 on second call for the same config', async () => {
      mockRedis.incr.mockResolvedValueOnce(2);
      const result = await service.nextVersion(BASE_CONFIG);
      expect(result.version).toBe(2);
    });

    it('returns the same reportId for the same config', async () => {
      mockRedis.incr.mockResolvedValue(1);
      const r1 = await service.nextVersion(BASE_CONFIG);
      const r2 = await service.nextVersion(BASE_CONFIG);
      expect(r1.reportId).toBe(r2.reportId);
    });

    it('returns a different reportId for a different period', async () => {
      mockRedis.incr.mockResolvedValue(1);
      const r1 = await service.nextVersion(BASE_CONFIG);
      const r2 = await service.nextVersion({ ...BASE_CONFIG, period: ReportPeriod.WEEKLY });
      expect(r1.reportId).not.toBe(r2.reportId);
    });

    it('falls back to version 1 when Redis fails', async () => {
      mockRedis.incr.mockRejectedValueOnce(new Error('INCR failed'));
      const result = await service.nextVersion(BASE_CONFIG);
      expect(result.version).toBe(1);
      expect(result.reportId).toBeTruthy();
    });
  });
});
