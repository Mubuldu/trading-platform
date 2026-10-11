import { ExperimentRunnerService } from '@modules/research/application/services/experiment-runner.service';
import { ExperimentTrackerService } from '@modules/research/application/services/experiment-tracker.service';
import { ResearchDataService } from '@modules/research/application/services/research-data.service';
import { PythonBridgeService } from '@modules/research/application/services/python-bridge.service';
import { OnnxInferenceService } from '@modules/research/application/services/onnx-inference.service';
import { FeatureEngineeringService } from '@modules/research/application/services/feature-engineering.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExperimentStatus } from '@modules/research/domain/enums/experiment-status.enum';
import { PromotionStage } from '@modules/research/domain/enums/promotion-stage.enum';
import { MlFramework } from '@modules/research/domain/enums/ml-framework.enum';
import { ResearchDataType } from '@modules/research/domain/enums/research-data-type.enum';
import { Experiment } from '@modules/research/domain/models/experiment.model';
import {
  ResearchDataset,
  ResearchCandle,
} from '@modules/research/domain/models/research-dataset.model';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generates N synthetic 1-hour OHLCV candles with a gentle uptrend. */
function makeCandles(n: number, startPrice = 30000): ResearchCandle[] {
  const candles: ResearchCandle[] = [];
  const startMs = 1_700_000_000_000;
  const hourMs = 3_600_000;
  let price = startPrice;

  for (let i = 0; i < n; i++) {
    price *= 1 + (Math.random() - 0.48) * 0.01; // slight upward drift
    candles.push({
      timestampMs: startMs + i * hourMs,
      open: price * 0.999,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 100 + Math.random() * 900,
    });
  }
  return candles;
}

function makeDataset(candleCount = 200): ResearchDataset {
  const candles = makeCandles(candleCount);
  return {
    id: 'ds-001',
    config: {
      exchangeId: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startTimeMs: candles[0]!.timestampMs,
      endTimeMs: candles[candles.length - 1]!.timestampMs,
      dataTypes: [ResearchDataType.OHLCV],
    },
    configHash: 'abc123',
    candles,
    fundingRates: [],
    openInterest: [],
    liquidations: [],
    volumeProfile: [],
    orderBookSnapshots: [],
    resolvedAt: new Date(),
    candleCount,
  };
}

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-001',
    name: 'Runner Test',
    description: 'Test run',
    config: {
      datasetConfig: {
        exchangeId: 'binance',
        symbol: 'BTC/USDT',
        timeframe: '1h',
        startTimeMs: 1_700_000_000_000,
        endTimeMs: 1_710_000_000_000,
        dataTypes: [ResearchDataType.OHLCV],
      },
      parameters: { fastPeriod: 5, slowPeriod: 20 },
      mlFramework: MlFramework.TYPESCRIPT_NATIVE,
      initialCapitalUsd: 10000,
      commissionBps: 10,
      slippageBps: 5,
    },
    commitHash: 'abc1234',
    randomSeed: 42,
    status: ExperimentStatus.PENDING,
    promotionStage: PromotionStage.RESEARCH,
    tags: [],
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExperimentRunnerService', () => {
  let service: ExperimentRunnerService;
  let tracker: jest.Mocked<ExperimentTrackerService>;
  let dataService: jest.Mocked<ResearchDataService>;
  let pythonBridge: jest.Mocked<PythonBridgeService>;
  let onnxInference: jest.Mocked<OnnxInferenceService>;
  let featureEngineering: jest.Mocked<FeatureEngineeringService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(() => {
    tracker = {
      findById: jest.fn(),
      markRunning: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ExperimentTrackerService>;

    dataService = {
      load: jest.fn().mockResolvedValue(makeDataset()),
    } as unknown as jest.Mocked<ResearchDataService>;

    pythonBridge = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<PythonBridgeService>;

    onnxInference = {
      run: jest.fn(),
    } as unknown as jest.Mocked<OnnxInferenceService>;

    featureEngineering = {
      buildMatrix: jest.fn().mockReturnValue({
        rows: [],
        featureNames: [],
        timestamps: [],
      }),
    } as unknown as jest.Mocked<FeatureEngineeringService>;

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new ExperimentRunnerService(
      tracker,
      dataService,
      pythonBridge,
      onnxInference,
      featureEngineering,
      logger,
    );
  });

  // ── Basic run ──────────────────────────────────────────────────────────────

  describe('run() — TYPESCRIPT_NATIVE backend', () => {
    it('returns an ExperimentResult with all required metric fields', async () => {
      tracker.findById.mockResolvedValue(makeExperiment());

      const result = await service.run('exp-001');

      expect(result.experimentId).toBe('exp-001');
      expect(typeof result.metrics.sharpeRatio).toBe('number');
      expect(typeof result.metrics.maxDrawdownPercent).toBe('number');
      expect(typeof result.metrics.pValue).toBe('number');
      expect(typeof result.metrics.isStatisticallyValid).toBe('boolean');
      expect(result.equityCurve.length).toBeGreaterThan(0);
      expect(result.computedAt).toBeInstanceOf(Date);
    });

    it('marks experiment RUNNING then COMPLETED on success', async () => {
      tracker.findById.mockResolvedValue(makeExperiment());

      await service.run('exp-001');

      expect(tracker.markRunning).toHaveBeenCalledWith('exp-001');
      expect(tracker.markCompleted).toHaveBeenCalledWith(
        'exp-001',
        expect.objectContaining({ experimentId: 'exp-001' }),
      );
      expect(tracker.markFailed).not.toHaveBeenCalled();
    });

    it('marks experiment FAILED and rethrows when data load fails', async () => {
      tracker.findById.mockResolvedValue(makeExperiment());
      dataService.load.mockRejectedValue(new Error('no data'));

      await expect(service.run('exp-001')).rejects.toThrow('no data');
      expect(tracker.markFailed).toHaveBeenCalledWith(
        'exp-001',
        expect.stringContaining('no data'),
      );
    });

    it('rejects if experiment is already RUNNING', async () => {
      tracker.findById.mockResolvedValue(makeExperiment({ status: ExperimentStatus.RUNNING }));

      await expect(service.run('exp-001')).rejects.toThrow(/already running/i);
    });
  });

  // ── Metrics correctness ────────────────────────────────────────────────────

  describe('metrics — large dataset (reproducibility check)', () => {
    it('produces deterministic metrics for the same seed across two runs', async () => {
      const dataset = makeDataset(500);
      dataService.load.mockResolvedValue(dataset);

      tracker.findById
        .mockResolvedValueOnce(makeExperiment({ id: 'exp-A' }))
        .mockResolvedValueOnce(makeExperiment({ id: 'exp-B' }));
      tracker.markCompleted.mockResolvedValue(undefined);

      const result1 = await service.run('exp-A');
      const result2 = await service.run('exp-B');

      // Native TS backend is deterministic — identical config + seed → same metrics
      expect(result1.metrics.sharpeRatio).toBeCloseTo(result2.metrics.sharpeRatio, 6);
      expect(result1.metrics.maxDrawdownPercent).toBeCloseTo(result2.metrics.maxDrawdownPercent, 6);
    });

    it('returns a valid p-value in range [0, 1]', async () => {
      tracker.findById.mockResolvedValue(makeExperiment());
      const result = await service.run('exp-001');

      expect(result.metrics.pValue).toBeGreaterThanOrEqual(0);
      expect(result.metrics.pValue).toBeLessThanOrEqual(1);
    });

    it('computes maxDrawdownPercent as a non-negative value', async () => {
      tracker.findById.mockResolvedValue(makeExperiment());
      const result = await service.run('exp-001');

      expect(result.metrics.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    });
  });

  // ── dryRun mode ───────────────────────────────────────────────────────────

  describe('dryRun option', () => {
    it('does not call markCompleted (no storage write) in dryRun mode', async () => {
      tracker.findById.mockResolvedValue(makeExperiment());

      await service.run('exp-001', { dryRun: true });

      expect(tracker.markCompleted).not.toHaveBeenCalled();
    });
  });

  // ── Multiple experiments ───────────────────────────────────────────────────

  describe('multiple experiments', () => {
    it('runs three different experiments independently without state leakage', async () => {
      const experiments = ['exp-A', 'exp-B', 'exp-C'].map((id) => makeExperiment({ id }));

      tracker.findById
        .mockResolvedValueOnce(experiments[0]!)
        .mockResolvedValueOnce(experiments[1]!)
        .mockResolvedValueOnce(experiments[2]!);

      const results = await Promise.all(experiments.map((e) => service.run(e.id)));

      expect(results).toHaveLength(3);
      expect(results[0]!.experimentId).toBe('exp-A');
      expect(results[1]!.experimentId).toBe('exp-B');
      expect(results[2]!.experimentId).toBe('exp-C');
    });
  });
});
