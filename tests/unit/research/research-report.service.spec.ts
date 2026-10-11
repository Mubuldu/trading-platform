import { ResearchReportService } from '@modules/research/application/reporters/research-report.service';
import { ExperimentStorageService } from '@modules/research/storage/experiment-storage.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExperimentStatus } from '@modules/research/domain/enums/experiment-status.enum';
import { PromotionStage } from '@modules/research/domain/enums/promotion-stage.enum';
import { MlFramework } from '@modules/research/domain/enums/ml-framework.enum';
import { ResearchDataType } from '@modules/research/domain/enums/research-data-type.enum';
import { Experiment } from '@modules/research/domain/models/experiment.model';
import {
  ExperimentResult,
  ExperimentMetrics,
} from '@modules/research/domain/models/experiment-result.model';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<ExperimentMetrics> = {}): ExperimentMetrics {
  return {
    totalReturnPercent: 20,
    annualizedReturnPercent: 12,
    cagr: 0.12,
    sharpeRatio: 1.2,
    sortinoRatio: 1.8,
    calmarRatio: 0.7,
    omegaRatio: 1.3,
    maxDrawdownPercent: 15,
    avgDrawdownPercent: 4,
    maxDrawdownDurationDays: 14,
    ulcerIndex: 3,
    tradeCount: 60,
    winRate: 0.53,
    profitFactor: 1.5,
    avgWinPercent: 2.0,
    avgLossPercent: 1.1,
    avgHoldingPeriodBars: 10,
    expectancy: 0.4,
    annualizedVolatility: 0.18,
    downwardVolatility: 0.11,
    pValue: 0.03,
    isStatisticallyValid: true,
    tStatistic: 2.0,
    degreesOfFreedom: 59,
    ...overrides,
  };
}

function makeResult(
  experimentId: string,
  metricsOverrides: Partial<ExperimentMetrics> = {},
): ExperimentResult {
  return {
    experimentId,
    metrics: makeMetrics(metricsOverrides),
    equityCurve: [],
    trades: [],
    customMetrics: {},
    rawOutput: '',
    computedAt: new Date(),
  };
}

function makeExperiment(id: string, overrides: Partial<Experiment> = {}): Experiment {
  return {
    id,
    name: `Experiment ${id}`,
    description: 'test',
    config: {
      datasetConfig: {
        exchangeId: 'binance',
        symbol: 'BTC/USDT',
        timeframe: '1h',
        startTimeMs: 1_700_000_000_000,
        endTimeMs: 1_710_000_000_000,
        dataTypes: [ResearchDataType.OHLCV],
      },
      parameters: {},
      mlFramework: MlFramework.TYPESCRIPT_NATIVE,
    },
    commitHash: 'abc1234',
    randomSeed: 42,
    status: ExperimentStatus.COMPLETED,
    promotionStage: PromotionStage.RESEARCH,
    tags: [],
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ResearchReportService', () => {
  let service: ResearchReportService;
  let storage: jest.Mocked<ExperimentStorageService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(() => {
    storage = {
      listAll: jest.fn().mockResolvedValue([]),
      findResultById: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ExperimentStorageService>;

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new ResearchReportService(storage, logger);
  });

  // ── generateReport() ───────────────────────────────────────────────────────

  describe('generateReport()', () => {
    it('returns an empty report when there are no completed experiments', async () => {
      storage.listAll.mockResolvedValue([]);

      const report = await service.generateReport();

      expect(report.ranked).toHaveLength(0);
      expect(report.statisticallyRejected).toHaveLength(0);
      expect(report.totalEvaluated).toBe(0);
    });

    it('excludes statistically invalid experiments (p ≥ 0.05) by default', async () => {
      const exp1 = makeExperiment('exp-1');
      const exp2 = makeExperiment('exp-2');

      storage.listAll.mockResolvedValue([exp1, exp2]);
      storage.findResultById
        .mockResolvedValueOnce(makeResult('exp-1', { pValue: 0.03, isStatisticallyValid: true }))
        .mockResolvedValueOnce(makeResult('exp-2', { pValue: 0.12, isStatisticallyValid: false }));

      const report = await service.generateReport();

      expect(report.ranked).toHaveLength(1);
      expect(report.ranked[0]!.experiment.id).toBe('exp-1');
      expect(report.statisticallyRejected).toHaveLength(1);
      expect(report.statisticallyRejected[0]!.experimentId).toBe('exp-2');
      expect(report.totalRejected).toBe(1);
    });

    it('includes invalid experiments when filter.includeInvalid is true', async () => {
      const exp = makeExperiment('exp-1');
      storage.listAll.mockResolvedValue([exp]);
      storage.findResultById.mockResolvedValue(
        makeResult('exp-1', { pValue: 0.2, isStatisticallyValid: false }),
      );

      const report = await service.generateReport({
        filter: { includeInvalid: true },
      });

      expect(report.ranked).toHaveLength(1);
      expect(report.statisticallyRejected).toHaveLength(0);
    });

    it('ranks experiments by Sharpe ratio in descending order by default', async () => {
      const experiments = ['exp-1', 'exp-2', 'exp-3'].map((id) => makeExperiment(id));
      storage.listAll.mockResolvedValue(experiments);

      const sharpes = [0.8, 2.5, 1.5];
      experiments.forEach((exp, i) => {
        storage.findResultById.mockResolvedValueOnce(
          makeResult(exp.id, { sharpeRatio: sharpes[i] }),
        );
      });

      const report = await service.generateReport({ rankingMetric: 'sharpeRatio' });

      const rankIds = report.ranked.map((r) => r.experiment.id);
      expect(rankIds).toEqual(['exp-2', 'exp-3', 'exp-1']); // 2.5 > 1.5 > 0.8
    });

    it('assigns consecutive ranks starting at 1', async () => {
      const experiments = ['exp-A', 'exp-B'].map((id) => makeExperiment(id));
      storage.listAll.mockResolvedValue(experiments);
      experiments.forEach((exp) => {
        storage.findResultById.mockResolvedValueOnce(makeResult(exp.id));
      });

      const report = await service.generateReport();

      expect(report.ranked[0]?.rank).toBe(1);
      expect(report.ranked[1]?.rank).toBe(2);
    });

    it('marks experiments without results in missingResults', async () => {
      const exp = makeExperiment('exp-orphan');
      storage.listAll.mockResolvedValue([exp]);
      storage.findResultById.mockResolvedValue(null);

      const report = await service.generateReport();

      expect(report.missingResults).toContain('exp-orphan');
      expect(report.ranked).toHaveLength(0);
    });

    it('ranks by maxDrawdownPercent in ascending order (lower = better)', async () => {
      const experiments = ['exp-low', 'exp-high'].map((id) => makeExperiment(id));
      storage.listAll.mockResolvedValue(experiments);

      storage.findResultById
        .mockResolvedValueOnce(makeResult('exp-low', { maxDrawdownPercent: 10 }))
        .mockResolvedValueOnce(makeResult('exp-high', { maxDrawdownPercent: 40 }));

      const report = await service.generateReport({ rankingMetric: 'maxDrawdownPercent' });

      expect(report.ranked[0]!.experiment.id).toBe('exp-low');
    });

    it('respects topN limit', async () => {
      const experiments = Array.from({ length: 10 }, (_, i) => makeExperiment(`exp-${i}`));
      storage.listAll.mockResolvedValue(experiments);
      experiments.forEach((exp) => {
        storage.findResultById.mockResolvedValueOnce(makeResult(exp.id));
      });

      const report = await service.generateReport({ topN: 3 });

      expect(report.ranked.length).toBeLessThanOrEqual(3);
    });

    it('filters by promotion stage', async () => {
      const expResearch = makeExperiment('exp-r', { promotionStage: PromotionStage.RESEARCH });
      const expValidated = makeExperiment('exp-v', { promotionStage: PromotionStage.VALIDATION });
      storage.listAll.mockResolvedValue([expResearch, expValidated]);

      storage.findResultById
        .mockResolvedValueOnce(makeResult('exp-r'))
        .mockResolvedValueOnce(makeResult('exp-v'));

      const report = await service.generateReport({
        filter: { stages: [PromotionStage.VALIDATION] },
      });

      expect(report.ranked).toHaveLength(1);
      expect(report.ranked[0]!.experiment.id).toBe('exp-v');
    });

    it('filters by tags (OR logic)', async () => {
      const expMom = makeExperiment('exp-momentum', { tags: ['momentum'] });
      const expMR = makeExperiment('exp-mr', { tags: ['mean-reversion'] });
      const expBoth = makeExperiment('exp-both', { tags: ['momentum', 'volatility'] });

      storage.listAll.mockResolvedValue([expMom, expMR, expBoth]);
      [expMom, expMR, expBoth].forEach((exp) => {
        storage.findResultById.mockResolvedValueOnce(makeResult(exp.id));
      });

      const report = await service.generateReport({
        filter: { tags: ['momentum'] },
      });

      const ids = report.ranked.map((r) => r.experiment.id);
      expect(ids).toContain('exp-momentum');
      expect(ids).toContain('exp-both');
      expect(ids).not.toContain('exp-mr');
    });
  });

  // ── compareExperiments() ───────────────────────────────────────────────────

  describe('compareExperiments()', () => {
    it('compares a specific list of experiments by ID', async () => {
      const exp1 = makeExperiment('exp-1');
      const exp2 = makeExperiment('exp-2');

      storage.findById.mockResolvedValueOnce(exp1).mockResolvedValueOnce(exp2);
      storage.findResultById
        .mockResolvedValueOnce(makeResult('exp-1', { sharpeRatio: 1.5 }))
        .mockResolvedValueOnce(makeResult('exp-2', { sharpeRatio: 2.0 }));

      const report = await service.compareExperiments(['exp-1', 'exp-2']);

      expect(report.ranked).toHaveLength(2);
      expect(report.ranked[0]!.experiment.id).toBe('exp-2'); // higher Sharpe wins
    });

    it('adds unknown IDs to missingResults', async () => {
      storage.findById.mockResolvedValue(null);

      const report = await service.compareExperiments(['ghost-id']);

      expect(report.missingResults).toContain('ghost-id');
    });
  });

  // ── formatSummary() ────────────────────────────────────────────────────────

  describe('formatSummary()', () => {
    it('returns a string containing metric headers', async () => {
      const exp = makeExperiment('exp-1');
      storage.listAll.mockResolvedValue([exp]);
      storage.findResultById.mockResolvedValue(makeResult('exp-1'));

      const report = await service.generateReport();
      const summary = service.formatSummary(report);

      expect(typeof summary).toBe('string');
      expect(summary).toContain('Research Report');
      expect(summary).toContain('Sharpe');
    });

    it('lists rejected experiments in the summary when present', async () => {
      const exp = makeExperiment('exp-bad');
      storage.listAll.mockResolvedValue([exp]);
      storage.findResultById.mockResolvedValue(
        makeResult('exp-bad', { pValue: 0.99, isStatisticallyValid: false }),
      );

      const report = await service.generateReport();
      const summary = service.formatSummary(report);

      expect(summary).toContain('Statistically Rejected');
    });
  });

  // ── Composite scoring ──────────────────────────────────────────────────────

  describe('composite score ranking', () => {
    it('uses composite weights when provided', async () => {
      const experiments = ['exp-high-sharpe', 'exp-low-dd'].map((id) => makeExperiment(id));
      storage.listAll.mockResolvedValue(experiments);

      // High Sharpe but big drawdown vs Low Sharpe but tiny drawdown
      storage.findResultById
        .mockResolvedValueOnce(
          makeResult('exp-high-sharpe', { sharpeRatio: 3.0, maxDrawdownPercent: 50 }),
        )
        .mockResolvedValueOnce(
          makeResult('exp-low-dd', { sharpeRatio: 1.0, maxDrawdownPercent: 5 }),
        );

      const report = await service.generateReport({
        compositeWeights: {
          sharpe: 0.1,
          sortino: 0.1,
          maxDrawdown: 0.7, // heavily penalise drawdown
          totalReturn: 0.05,
          profitFactor: 0.05,
        },
      });

      // With heavy drawdown weight, low-DD experiment should rank first
      expect(report.ranked[0]!.experiment.id).toBe('exp-low-dd');
    });
  });
});
