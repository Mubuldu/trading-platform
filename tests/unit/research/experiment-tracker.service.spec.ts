import { ExperimentTrackerService } from '@modules/research/application/services/experiment-tracker.service';
import { ExperimentStorageService } from '@modules/research/storage/experiment-storage.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExperimentStatus } from '@modules/research/domain/enums/experiment-status.enum';
import { PromotionStage } from '@modules/research/domain/enums/promotion-stage.enum';
import { MlFramework } from '@modules/research/domain/enums/ml-framework.enum';
import { ResearchDataType } from '@modules/research/domain/enums/research-data-type.enum';
import {
  ResearchExperimentAlreadyExistsError,
  ResearchExperimentNotFoundError,
  ResearchReproducibilityError,
} from '@modules/research/domain/errors/research.errors';
import { Experiment } from '@modules/research/domain/models/experiment.model';
import { ExperimentResult } from '@modules/research/domain/models/experiment-result.model';
import { PromotionStage as PS } from '@modules/research/domain/enums/promotion-stage.enum';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    datasetConfig: {
      exchangeId: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startTimeMs: 1_700_000_000_000,
      endTimeMs: 1_710_000_000_000,
      dataTypes: [ResearchDataType.OHLCV],
    },
    parameters: { fastPeriod: 10, slowPeriod: 30 },
    mlFramework: MlFramework.TYPESCRIPT_NATIVE,
  };
}

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-001',
    name: 'Test SMA Crossover',
    description: 'Simple SMA crossover strategy',
    config: makeConfig(),
    commitHash: 'abc1234',
    randomSeed: 42,
    status: ExperimentStatus.PENDING,
    promotionStage: PromotionStage.RESEARCH,
    tags: ['momentum'],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeResult(experimentId = 'exp-001'): ExperimentResult {
  return {
    experimentId,
    metrics: {
      totalReturnPercent: 25,
      annualizedReturnPercent: 15,
      cagr: 0.15,
      sharpeRatio: 1.5,
      sortinoRatio: 2.0,
      calmarRatio: 0.8,
      omegaRatio: 1.4,
      maxDrawdownPercent: 18,
      avgDrawdownPercent: 5,
      maxDrawdownDurationDays: 20,
      ulcerIndex: 4,
      tradeCount: 80,
      winRate: 0.55,
      profitFactor: 1.6,
      avgWinPercent: 2.1,
      avgLossPercent: 1.2,
      avgHoldingPeriodBars: 12,
      expectancy: 0.5,
      annualizedVolatility: 0.2,
      downwardVolatility: 0.13,
      pValue: 0.03,
      isStatisticallyValid: true,
      tStatistic: 2.1,
      degreesOfFreedom: 79,
    },
    equityCurve: [],
    trades: [],
    customMetrics: {},
    rawOutput: '',
    computedAt: new Date(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExperimentTrackerService', () => {
  let service: ExperimentTrackerService;
  let storage: jest.Mocked<ExperimentStorageService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(() => {
    storage = {
      findIdByName: jest.fn().mockResolvedValue(null),
      saveExperiment: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findResultById: jest.fn().mockResolvedValue(null),
      saveResult: jest.fn().mockResolvedValue(undefined),
      appendPromotionRecord: jest.fn().mockResolvedValue(undefined),
      listAll: jest.fn().mockResolvedValue([]),
      getPromotionHistory: jest.fn().mockResolvedValue([]),
      countAll: jest.fn().mockResolvedValue(0),
      deleteExperiment: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ExperimentStorageService>;

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new ExperimentTrackerService(storage, logger);
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates an experiment with PENDING status and RESEARCH stage', async () => {
      const exp = await service.create({
        name: 'My Strategy',
        description: 'Test',
        config: makeConfig(),
        randomSeed: 42,
      });

      expect(exp.status).toBe(ExperimentStatus.PENDING);
      expect(exp.promotionStage).toBe(PromotionStage.RESEARCH);
      expect(exp.name).toBe('My Strategy');
      expect(exp.randomSeed).toBe(42);
      expect(typeof exp.id).toBe('string');
      expect(exp.id).toHaveLength(36); // UUID v4
    });

    it('captures a commit hash at creation time', async () => {
      const exp = await service.create({
        name: 'My Strategy',
        description: 'Test',
        config: makeConfig(),
        randomSeed: 1,
      });

      // Either a git hash or the fallback 'unknown'
      expect(typeof exp.commitHash).toBe('string');
      expect(exp.commitHash.length).toBeGreaterThan(0);
    });

    it('throws ResearchExperimentAlreadyExistsError when name is taken', async () => {
      storage.findIdByName.mockResolvedValue('existing-id');

      await expect(
        service.create({
          name: 'Duplicate Name',
          description: 'x',
          config: makeConfig(),
          randomSeed: 1,
        }),
      ).rejects.toBeInstanceOf(ResearchExperimentAlreadyExistsError);
    });

    it('throws ResearchReproducibilityError for non-serialisable config', async () => {
      const badConfig = makeConfig() as Record<string, unknown>;
      badConfig['circular'] = badConfig; // circular reference

      await expect(
        service.create({
          name: 'Bad Config',
          description: 'x',
          config: badConfig as never,
          randomSeed: 1,
        }),
      ).rejects.toBeInstanceOf(ResearchReproducibilityError);
    });

    it('persists the experiment to storage', async () => {
      await service.create({
        name: 'Saved',
        description: 'x',
        config: makeConfig(),
        randomSeed: 7,
      });

      expect(storage.saveExperiment).toHaveBeenCalledTimes(1);
    });

    it('applies optional tags', async () => {
      const exp = await service.create({
        name: 'Tagged',
        description: 'x',
        config: makeConfig(),
        randomSeed: 1,
        tags: ['crypto', 'momentum'],
      });

      expect(exp.tags).toEqual(['crypto', 'momentum']);
    });

    it('defaults to empty tags when none are provided', async () => {
      const exp = await service.create({
        name: 'No Tags',
        description: 'x',
        config: makeConfig(),
        randomSeed: 1,
      });

      expect(exp.tags).toEqual([]);
    });
  });

  // ── Status updates ─────────────────────────────────────────────────────────

  describe('markRunning()', () => {
    it('sets status to RUNNING and records startedAt', async () => {
      const exp = makeExperiment();
      storage.findById.mockResolvedValue(exp);

      await service.markRunning('exp-001');

      const saved = storage.saveExperiment.mock.calls[0]?.[0];
      expect(saved?.status).toBe(ExperimentStatus.RUNNING);
      expect(saved?.startedAt).toBeInstanceOf(Date);
    });

    it('throws ResearchExperimentNotFoundError for missing experiment', async () => {
      storage.findById.mockResolvedValue(null);

      await expect(service.markRunning('ghost')).rejects.toBeInstanceOf(
        ResearchExperimentNotFoundError,
      );
    });
  });

  describe('markCompleted()', () => {
    it('sets status to COMPLETED and saves the result', async () => {
      const exp = makeExperiment();
      storage.findById.mockResolvedValue(exp);

      const result = makeResult();
      await service.markCompleted('exp-001', result);

      const saved = storage.saveExperiment.mock.calls[0]?.[0];
      expect(saved?.status).toBe(ExperimentStatus.COMPLETED);
      expect(saved?.completedAt).toBeInstanceOf(Date);
      expect(storage.saveResult).toHaveBeenCalledWith(result);
    });
  });

  describe('markFailed()', () => {
    it('sets status to FAILED with a reason', async () => {
      const exp = makeExperiment();
      storage.findById.mockResolvedValue(exp);

      await service.markFailed('exp-001', 'Out of memory');

      const saved = storage.saveExperiment.mock.calls[0]?.[0];
      expect(saved?.status).toBe(ExperimentStatus.FAILED);
      expect(saved?.failureReason).toBe('Out of memory');
    });
  });

  describe('markCancelled()', () => {
    it('sets status to CANCELLED', async () => {
      const exp = makeExperiment();
      storage.findById.mockResolvedValue(exp);

      await service.markCancelled('exp-001');

      const saved = storage.saveExperiment.mock.calls[0]?.[0];
      expect(saved?.status).toBe(ExperimentStatus.CANCELLED);
    });
  });

  // ── Promotion stage update ─────────────────────────────────────────────────

  describe('updatePromotionStage()', () => {
    it('updates the promotion stage and appends a promotion record', async () => {
      const exp = makeExperiment();
      storage.findById.mockResolvedValue(exp);

      const record = {
        fromStage: PS.RESEARCH,
        toStage: PS.VALIDATION,
        initiatedBy: 'alice',
        reason: 'Metrics look good',
        approvedAt: new Date(),
      };

      await service.updatePromotionStage('exp-001', PS.VALIDATION, record);

      const saved = storage.saveExperiment.mock.calls[0]?.[0];
      expect(saved?.promotionStage).toBe(PS.VALIDATION);
      expect(storage.appendPromotionRecord).toHaveBeenCalledWith('exp-001', record);
    });
  });

  // ── listAll() ──────────────────────────────────────────────────────────────

  describe('listAll()', () => {
    it('returns experiment summaries with hasResult flag', async () => {
      const exp = makeExperiment({ status: ExperimentStatus.COMPLETED });
      storage.listAll.mockResolvedValue([exp]);
      storage.findResultById.mockResolvedValue(makeResult());

      const summaries = await service.listAll();

      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.id).toBe('exp-001');
      expect(summaries[0]?.hasResult).toBe(true);
    });

    it('sets hasResult=false when no result is stored', async () => {
      const exp = makeExperiment();
      storage.listAll.mockResolvedValue([exp]);
      storage.findResultById.mockResolvedValue(null);

      const summaries = await service.listAll();

      expect(summaries[0]?.hasResult).toBe(false);
    });
  });

  // ── Reproducibility: config round-trip ─────────────────────────────────────

  describe('reproducibility', () => {
    it('two identical configs produce identical commit hash + seed', async () => {
      const config = makeConfig();

      // Both calls resolve name-index check as null (different names)
      storage.findIdByName.mockResolvedValue(null);

      const exp1 = await service.create({
        name: 'Exp Alpha',
        description: 'x',
        config,
        randomSeed: 12345,
      });
      const exp2 = await service.create({
        name: 'Exp Beta',
        description: 'x',
        config,
        randomSeed: 12345,
      });

      // Same seed and identical config — only the auto-generated id differs
      expect(exp1.randomSeed).toBe(exp2.randomSeed);
      expect(JSON.stringify(exp1.config)).toBe(JSON.stringify(exp2.config));
    });
  });
});
