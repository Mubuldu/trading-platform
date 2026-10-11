import { PromotionPipelineService } from '@modules/research/promotion/promotion-pipeline.service';
import { ExperimentStorageService } from '@modules/research/storage/experiment-storage.service';
import { ExperimentTrackerService } from '@modules/research/application/services/experiment-tracker.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  PromotionStage,
  PROMOTION_PIPELINE,
} from '@modules/research/domain/enums/promotion-stage.enum';
import { ExperimentStatus } from '@modules/research/domain/enums/experiment-status.enum';
import { MlFramework } from '@modules/research/domain/enums/ml-framework.enum';
import { ResearchDataType } from '@modules/research/domain/enums/research-data-type.enum';
import { Experiment } from '@modules/research/domain/models/experiment.model';
import {
  ExperimentResult,
  ExperimentMetrics,
} from '@modules/research/domain/models/experiment-result.model';
import { PromotionRequest } from '@modules/research/domain/models/promotion-request.model';
import {
  ResearchExperimentNotFoundError,
  ResearchInvalidPromotionStageError,
  ResearchPromotionStageMissingError,
  ResearchStatisticalValidationError,
  ResearchProductionContaminationError,
} from '@modules/research/domain/errors/research.errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExperiment(
  stage: PromotionStage = PromotionStage.RESEARCH,
  overrides: Partial<Experiment> = {},
): Experiment {
  return {
    id: 'exp-001',
    name: 'Pipeline Test',
    description: 'Promotion pipeline test',
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
    promotionStage: stage,
    tags: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeResult(
  experimentId = 'exp-001',
  metricsOverrides: Partial<ExperimentMetrics> = {},
): ExperimentResult {
  return {
    experimentId,
    metrics: {
      totalReturnPercent: 25,
      annualizedReturnPercent: 15,
      cagr: 0.15,
      sharpeRatio: 1.5, // ≥ 0.5 (VALIDATION threshold)
      sortinoRatio: 2.0,
      calmarRatio: 0.8,
      omegaRatio: 1.4,
      maxDrawdownPercent: 20, // ≤ 35% (WALK_FORWARD threshold)
      avgDrawdownPercent: 5,
      maxDrawdownDurationDays: 14,
      ulcerIndex: 3,
      tradeCount: 80,
      winRate: 0.56, // ≥ 0.45 (PAPER_TRADING threshold)
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
      ...metricsOverrides,
    },
    equityCurve: [],
    trades: [],
    customMetrics: {},
    rawOutput: '',
    computedAt: new Date(),
  };
}

function makeRequest(
  targetStage: PromotionStage,
  overrides: Partial<PromotionRequest> = {},
): PromotionRequest {
  return {
    experimentId: 'exp-001',
    targetStage,
    initiatedBy: 'alice',
    reason: 'Metrics look good',
    requestedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PromotionPipelineService', () => {
  let service: PromotionPipelineService;
  let storage: jest.Mocked<ExperimentStorageService>;
  let tracker: jest.Mocked<ExperimentTrackerService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(() => {
    storage = {
      findById: jest.fn().mockResolvedValue(null),
      findResultById: jest.fn().mockResolvedValue(null),
      getPromotionHistory: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ExperimentStorageService>;

    tracker = {
      updatePromotionStage: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ExperimentTrackerService>;

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new PromotionPipelineService(storage, tracker, logger);
  });

  // ── promote() ─────────────────────────────────────────────────────────────

  describe('promote()', () => {
    it('advances RESEARCH → VALIDATION when metrics pass', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.RESEARCH));
      storage.findResultById.mockResolvedValue(makeResult());

      const result = await service.promote(makeRequest(PromotionStage.VALIDATION));

      expect(result.passed).toBe(true);
      expect(tracker.updatePromotionStage).toHaveBeenCalledWith(
        'exp-001',
        PromotionStage.VALIDATION,
        expect.objectContaining({
          fromStage: PromotionStage.RESEARCH,
          toStage: PromotionStage.VALIDATION,
          initiatedBy: 'alice',
        }),
      );
    });

    it('returns passed=false and does NOT advance when VALIDATION Sharpe is too low', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.RESEARCH));
      storage.findResultById.mockResolvedValue(
        makeResult('exp-001', { sharpeRatio: 0.2 }), // below 0.5 threshold
      );

      const result = await service.promote(makeRequest(PromotionStage.VALIDATION));

      expect(result.passed).toBe(false);
      expect(result.notes).toContain('Sharpe');
      expect(tracker.updatePromotionStage).not.toHaveBeenCalled();
    });

    it('returns passed=false when WALK_FORWARD max drawdown is exceeded', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.VALIDATION));
      storage.findResultById.mockResolvedValue(
        makeResult('exp-001', { maxDrawdownPercent: 40 }), // > 35% limit
      );

      const result = await service.promote(makeRequest(PromotionStage.WALK_FORWARD));

      expect(result.passed).toBe(false);
      expect(result.notes).toContain('drawdown');
    });

    it('returns passed=false when PAPER_TRADING win rate is too low', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.MONTE_CARLO));
      storage.findResultById.mockResolvedValue(
        makeResult('exp-001', { winRate: 0.3, sharpeRatio: 1.0 }), // below 0.45
      );

      const result = await service.promote(makeRequest(PromotionStage.PAPER_TRADING));

      expect(result.passed).toBe(false);
      expect(result.notes).toContain('Win rate');
    });

    it('throws ResearchExperimentNotFoundError for an unknown experiment', async () => {
      storage.findById.mockResolvedValue(null);

      await expect(service.promote(makeRequest(PromotionStage.VALIDATION))).rejects.toBeInstanceOf(
        ResearchExperimentNotFoundError,
      );
    });

    it('throws ResearchStatisticalValidationError when p ≥ 0.05', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.RESEARCH));
      storage.findResultById.mockResolvedValue(
        makeResult('exp-001', { pValue: 0.2, isStatisticallyValid: false }),
      );

      await expect(service.promote(makeRequest(PromotionStage.VALIDATION))).rejects.toBeInstanceOf(
        ResearchStatisticalValidationError,
      );
    });
  });

  // ── Stage order enforcement ────────────────────────────────────────────────

  describe('stage order enforcement (no skipping)', () => {
    it('throws ResearchPromotionStageMissingError when skipping VALIDATION', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.RESEARCH));
      storage.findResultById.mockResolvedValue(makeResult());

      // Try to jump from RESEARCH directly to WALK_FORWARD
      await expect(
        service.promote(makeRequest(PromotionStage.WALK_FORWARD)),
      ).rejects.toBeInstanceOf(ResearchPromotionStageMissingError);
    });

    it('throws ResearchInvalidPromotionStageError when already at terminal stage', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.PRODUCTION));
      storage.findResultById.mockResolvedValue(makeResult());

      await expect(service.promote(makeRequest(PromotionStage.REJECTED))).rejects.toBeInstanceOf(
        ResearchInvalidPromotionStageError,
      );
    });

    it('throws ResearchInvalidPromotionStageError for backward promotion', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.WALK_FORWARD));
      storage.findResultById.mockResolvedValue(makeResult());

      await expect(service.promote(makeRequest(PromotionStage.VALIDATION))).rejects.toBeInstanceOf(
        ResearchInvalidPromotionStageError,
      );
    });

    it('enforces the full pipeline order RESEARCH → PRODUCTION', () => {
      // Verify PROMOTION_PIPELINE is ordered as expected
      expect(PROMOTION_PIPELINE).toEqual([
        PromotionStage.RESEARCH,
        PromotionStage.VALIDATION,
        PromotionStage.WALK_FORWARD,
        PromotionStage.MONTE_CARLO,
        PromotionStage.PAPER_TRADING,
        PromotionStage.MANUAL_APPROVAL,
        PromotionStage.PRODUCTION,
      ]);
    });
  });

  // ── Production approval token ─────────────────────────────────────────────

  describe('MANUAL_APPROVAL → PRODUCTION', () => {
    it('requires a valid productionApprovalToken', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.MANUAL_APPROVAL));
      storage.findResultById.mockResolvedValue(makeResult());

      await expect(
        service.promote(
          makeRequest(PromotionStage.PRODUCTION, {
            productionApprovalToken: 'WRONG-TOKEN',
          }),
        ),
      ).rejects.toBeInstanceOf(ResearchProductionContaminationError);
    });

    it('succeeds with the correct approval token', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.MANUAL_APPROVAL));
      storage.findResultById.mockResolvedValue(makeResult());

      const result = await service.promote(
        makeRequest(PromotionStage.PRODUCTION, {
          productionApprovalToken: 'APPROVE-PRODUCTION-exp-001',
        }),
      );

      expect(result.passed).toBe(true);
    });

    it('rejects when token is omitted', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.MANUAL_APPROVAL));
      storage.findResultById.mockResolvedValue(makeResult());

      await expect(
        service.promote(
          makeRequest(PromotionStage.PRODUCTION, {
            productionApprovalToken: undefined,
          }),
        ),
      ).rejects.toBeInstanceOf(ResearchProductionContaminationError);
    });
  });

  // ── reject() ──────────────────────────────────────────────────────────────

  describe('reject()', () => {
    it('moves experiment to REJECTED terminal state', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.VALIDATION));

      await service.reject('exp-001', 'alice', 'Poor out-of-sample performance');

      expect(tracker.updatePromotionStage).toHaveBeenCalledWith(
        'exp-001',
        PromotionStage.REJECTED,
        expect.objectContaining({
          toStage: PromotionStage.REJECTED,
          initiatedBy: 'alice',
        }),
      );
    });

    it('throws ResearchProductionContaminationError when rejecting a PRODUCTION experiment', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.PRODUCTION));

      await expect(service.reject('exp-001', 'alice', 'Changed mind')).rejects.toBeInstanceOf(
        ResearchProductionContaminationError,
      );
    });

    it('throws ResearchExperimentNotFoundError for unknown experiment', async () => {
      storage.findById.mockResolvedValue(null);

      await expect(service.reject('ghost', 'alice', 'reason')).rejects.toBeInstanceOf(
        ResearchExperimentNotFoundError,
      );
    });
  });

  // ── getNextStage() ────────────────────────────────────────────────────────

  describe('getNextStage()', () => {
    it('returns the correct next stage for each pipeline stage', () => {
      expect(service.getNextStage(PromotionStage.RESEARCH)).toBe(PromotionStage.VALIDATION);
      expect(service.getNextStage(PromotionStage.VALIDATION)).toBe(PromotionStage.WALK_FORWARD);
      expect(service.getNextStage(PromotionStage.WALK_FORWARD)).toBe(PromotionStage.MONTE_CARLO);
      expect(service.getNextStage(PromotionStage.MONTE_CARLO)).toBe(PromotionStage.PAPER_TRADING);
      expect(service.getNextStage(PromotionStage.PAPER_TRADING)).toBe(
        PromotionStage.MANUAL_APPROVAL,
      );
      expect(service.getNextStage(PromotionStage.MANUAL_APPROVAL)).toBe(PromotionStage.PRODUCTION);
    });

    it('returns null for terminal stages', () => {
      expect(service.getNextStage(PromotionStage.PRODUCTION)).toBeNull();
      expect(service.getNextStage(PromotionStage.REJECTED)).toBeNull();
    });
  });

  // ── canPromote() ──────────────────────────────────────────────────────────

  describe('canPromote()', () => {
    it('returns true for a COMPLETED experiment in a non-terminal stage', async () => {
      storage.findById.mockResolvedValue(
        makeExperiment(PromotionStage.RESEARCH, { status: ExperimentStatus.COMPLETED }),
      );

      expect(await service.canPromote('exp-001')).toBe(true);
    });

    it('returns false for a FAILED experiment', async () => {
      storage.findById.mockResolvedValue(
        makeExperiment(PromotionStage.RESEARCH, { status: ExperimentStatus.FAILED }),
      );

      expect(await service.canPromote('exp-001')).toBe(false);
    });

    it('returns false for a PRODUCTION experiment', async () => {
      storage.findById.mockResolvedValue(makeExperiment(PromotionStage.PRODUCTION));

      expect(await service.canPromote('exp-001')).toBe(false);
    });

    it('returns false when experiment does not exist', async () => {
      storage.findById.mockResolvedValue(null);

      expect(await service.canPromote('ghost')).toBe(false);
    });
  });
});
