import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { StrategyPluginConfig } from '@modules/strategy/interfaces/strategy.interface';
import {
  TREND_FOLLOWING_V1_TYPE,
  createTrendFollowingV1Config,
  TrendFollowingV1Params,
} from '@modules/strategy/plugins/trend-following-v1/trend-following-v1.strategy';
import { BacktestConfig, ExtraIndicatorPeriods } from '../../domain/models/backtest-config.model';
import { PerformanceReport } from '../../domain/models/performance-report.model';
import {
  AcceptanceThresholds,
  OptimizationConfig,
  TfV1ParameterGrid,
} from '../../domain/models/optimization-config.model';
import {
  ComboEvaluation,
  OptimizationJobStatus,
  OptimizationResult,
  PerformanceSummary,
  TfV1ParamCombo,
} from '../../domain/models/optimization-result.model';
import { BacktestEngineService } from '../engine/backtest-engine.service';

const JOB_KEY_PREFIX = 'backtest:optimize:job:';
const JOB_TTL_SECONDS = 24 * 3600; // 24 h

// ─── TrendFollowingV1 parameter defaults ──────────────────────────────────────

const PARAM_DEFAULTS: Readonly<TfV1ParamCombo> = {
  emaPeriodFast: 50,
  emaPeriodSlow: 200,
  adxPeriod: 14,
  adxThreshold: 25,
  donchianWindow: 20,
  atrPeriod: 14,
  atrMultiplier: 2.0,
  atrMinThreshold: 0,
  volumeMaPeriod: 20,
  cooldownCandles: 3,
  maxHoldingCandles: 50,
  donchianBreakoutTolerancePct: 0.15,
};

const DEFAULT_THRESHOLDS: Required<AcceptanceThresholds> = {
  minSharpe: 0.8,
  minWinRate: 0.45,    // as a ratio 0–1
  minProfitFactor: 1.3,
  maxDrawdownPct: 20,
  minTrades: 50,
};

/**
 * BacktestOptimizerService runs a walk-forward grid search over TrendFollowingV1
 * parameters and validates the top candidates on an out-of-sample test period.
 *
 * ## Flow
 *   1. `startJob()` — expand grid, save initial status to Redis, kick off async job.
 *   2. `runJob()` (background) — run all combos on train, rank, validate top-N on test.
 *   3. `getJobStatus()` — caller polls Redis for progress and final result.
 *   4. Caller may call `applyConfig()` to push the best validated config to the live
 *      strategy registry — this step is always explicit, never automatic.
 *
 * ## Golden rule
 *   The test period is NEVER touched during training. The optimizer reads testStartMs
 *   and testEndMs only after the full train ranking is established.
 */
@Injectable()
export class BacktestOptimizerService {
  private readonly context = BacktestOptimizerService.name;

  constructor(
    private readonly engine: BacktestEngineService,
    private readonly redis: RedisClientService,
    private readonly logger: AppLoggerService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Expand the parameter grid, save an initial status record to Redis, then
   * start the optimization job in the background. Returns the jobId immediately
   * so the caller can poll `getJobStatus()`.
   */
  async startJob(config: OptimizationConfig): Promise<string> {
    const jobId = randomUUID();
    const combos = this.expandGrid(config.parameterGrid);
    const topN = config.topN ?? 3;

    const initial: OptimizationJobStatus = {
      jobId,
      status: 'RUNNING',
      startedAt: Date.now(),
      progress: { phase: 'TRAIN', current: 0, total: combos.length, pct: 0 },
    };

    await this.saveJobStatus(jobId, initial);

    this.logger.log(
      `Optimizer job ${jobId}: ${combos.length} valid combos, top-${topN} → test validation`,
      this.context,
    );

    // Fire-and-forget — errors update the job status to FAILED.
    this.runJob(jobId, config, combos, topN).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Optimizer job ${jobId} crashed: ${msg}`, (e as Error).stack, this.context);
      void this.markJobFailed(jobId, msg);
    });

    return jobId;
  }

  async getJobStatus(jobId: string): Promise<OptimizationJobStatus | null> {
    try {
      const raw = await this.redis.getClient().get(this.jobKey(jobId));
      if (!raw) return null;
      return JSON.parse(raw) as OptimizationJobStatus;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core grid search
  // ─────────────────────────────────────────────────────────────────────────

  private async runJob(
    jobId: string,
    config: OptimizationConfig,
    combos: TfV1ParamCombo[],
    topN: number,
  ): Promise<void> {
    const warnings: string[] = [];
    const extra = this.buildExtraPeriods(config.parameterGrid);
    const warmupCandles = config.warmupCandles ?? this.inferWarmupCandles(config.parameterGrid);

    // ── Phase 1: Train all combos ────────────────────────────────────────────
    const trainEvals: Array<{ params: TfV1ParamCombo; summary: PerformanceSummary; index: number }> = [];

    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i];

      // Update progress
      await this.updateProgress(jobId, 'TRAIN', i, combos.length, combo);

      // Yield to the event loop between combos so HTTP requests can be served.
      await yieldToEventLoop();

      try {
        const report = await this.runCombo(combo, config, config.trainStartMs, config.trainEndMs, warmupCandles, extra, `${jobId}-train-${i}`);
        if (report) {
          trainEvals.push({ params: combo, summary: toSummary(report), index: i });
        } else {
          warnings.push(`Combo ${i} produced no report on train period (no trades generated).`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Combo ${i} train error: ${msg}`, this.context);
        warnings.push(`Combo ${i} failed on train: ${msg}`);
      }
    }

    if (trainEvals.length === 0) {
      await this.markJobFailed(jobId, 'All parameter combos failed on the train period.');
      return;
    }

    // ── Rank by fitness metric ───────────────────────────────────────────────
    const rankMetric = config.rankBy ?? 'sharpeRatio';
    const ranked = [...trainEvals].sort((a, b) => fitness(b.summary, rankMetric) - fitness(a.summary, rankMetric));

    let allTrainEvals: ComboEvaluation[] = ranked.map((e, rank) => ({
      comboIndex: e.index,
      params: e.params,
      trainSummary: e.summary,
      trainRank: rank + 1,
      passesThresholds: false,
      overfit: false,
    }));

    // ── Phase 2: Validate top-N on test period ────────────────────────────────
    const actualTopN = Math.min(topN, ranked.length);
    const topNCandidates = ranked.slice(0, actualTopN);
    const thresholds = mergeThresholds(config.thresholds);

    const testEvals: Array<{ index: number; summary: PerformanceSummary }> = [];

    for (let j = 0; j < topNCandidates.length; j++) {
      const candidate = topNCandidates[j];

      await this.updateProgress(jobId, 'TEST', j, actualTopN, candidate.params);
      await yieldToEventLoop();

      try {
        const report = await this.runCombo(candidate.params, config, config.testStartMs, config.testEndMs, warmupCandles, extra, `${jobId}-test-${candidate.index}`);
        if (report) {
          testEvals.push({ index: candidate.index, summary: toSummary(report) });
        } else {
          warnings.push(`Top-${j + 1} combo (index ${candidate.index}) produced no trades on test period.`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Top-${j + 1} combo test error: ${msg}`, this.context);
        warnings.push(`Combo ${candidate.index} failed on test: ${msg}`);
      }
    }

    // ── Rank test results ────────────────────────────────────────────────────
    const testRanked = [...testEvals].sort((a, b) => fitness(b.summary, rankMetric) - fitness(a.summary, rankMetric));

    // Attach test results to the evaluations
    const testIndexMap = new Map(testRanked.map((t, rank) => [t.index, { summary: t.summary, rank: rank + 1 }]));

    const topNEvals: ComboEvaluation[] = topNCandidates.map((candidate) => {
      const testData = testIndexMap.get(candidate.index);
      const testSummary = testData?.summary;
      const passesThresholds = testSummary ? checkThresholds(testSummary, thresholds) : false;
      const overfit = detectOverfit(candidate.summary, testSummary);

      return {
        comboIndex: candidate.index,
        params: candidate.params,
        trainSummary: candidate.summary,
        trainRank: ranked.findIndex((r) => r.index === candidate.index) + 1,
        testSummary,
        testRank: testData?.rank,
        passesThresholds,
        overfit,
      };
    });

    // Patch allTrainEvals with test data where available
    allTrainEvals = allTrainEvals.map((e) => {
      const enriched = topNEvals.find((t) => t.comboIndex === e.comboIndex);
      return enriched ?? e;
    });

    // ── Best results ─────────────────────────────────────────────────────────
    const bestByTrain = allTrainEvals[0];
    const validatedCombos = topNEvals.filter((e) => e.passesThresholds && !e.overfit);
    const bestByTest = validatedCombos.sort((a, b) => (a.testRank ?? 999) - (b.testRank ?? 999))[0];

    let bestValidatedConfig: StrategyPluginConfig | undefined;
    if (bestByTest) {
      bestValidatedConfig = this.buildStrategyConfig(bestByTest.params, jobId, config);
    } else {
      warnings.push('No combo passed acceptance thresholds on the test period. Strategy may be overfit.');
    }

    // ── Overfit diagnostics ───────────────────────────────────────────────────
    const trainTestCorrelation = computeSpearmanCorrelation(
      topNCandidates.map((c) => fitness(c.summary, rankMetric)),
      topNEvals.map((e) => (e.testSummary ? fitness(e.testSummary, rankMetric) : 0)),
    );
    const isOverfit = trainTestCorrelation !== undefined && trainTestCorrelation < 0.4;

    if (isOverfit) {
      warnings.push(
        `Train–test rank correlation is low (${trainTestCorrelation.toFixed(2)}), ` +
          `indicating overfitting. Consider narrowing the search space or extending the train period.`,
      );
    }

    // ── Finalise ──────────────────────────────────────────────────────────────
    const result: OptimizationResult = {
      jobId,
      config,
      totalCombinations: combos.length,
      validCombinations: trainEvals.length,
      topN: actualTopN,
      trainPeriod: { startMs: config.trainStartMs, endMs: config.trainEndMs },
      testPeriod: { startMs: config.testStartMs, endMs: config.testEndMs },
      bestByTrain,
      bestByTest,
      bestValidatedConfig,
      trainTestCorrelation,
      isOverfit,
      allTrainEvaluations: allTrainEvals,
      topNEvaluations: topNEvals,
      warnings,
    };

    const now = Date.now();
    const status = await this.getJobStatus(jobId);
    const startedAt = status?.startedAt ?? now;

    await this.saveJobStatus(jobId, {
      jobId,
      status: 'COMPLETED',
      startedAt,
      completedAt: now,
      durationMs: now - startedAt,
      progress: { phase: 'TEST', current: actualTopN, total: actualTopN, pct: 100 },
      result,
    });

    this.logger.log(
      `Optimizer job ${jobId} done. ` +
        `Train best: Sharpe=${bestByTrain.trainSummary.sharpeRatio.toFixed(2)}, ` +
        (bestByTest
          ? `Validated: Sharpe=${bestByTest.testSummary!.sharpeRatio.toFixed(2)}`
          : 'No validated combo found'),
      this.context,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Single-combo backtest
  // ─────────────────────────────────────────────────────────────────────────

  private async runCombo(
    params: TfV1ParamCombo,
    config: OptimizationConfig,
    startMs: number,
    endMs: number,
    warmupCandles: number,
    extra: ExtraIndicatorPeriods,
    sessionSuffix: string,
  ): Promise<PerformanceReport | undefined> {
    const strategyId = `opt-${sessionSuffix}`;
    const strategyConfig = this.buildStrategyConfig(params, sessionSuffix, config);
    strategyConfig.strategyId; // Ensure it's used

    const backtestConfig: BacktestConfig = {
      sessionId: randomUUID(),
      symbol: config.symbol,
      exchange: config.exchange,
      timeframe: config.timeframe,
      startTime: startMs,
      endTime: endMs,
      warmupCandles,
      initialCapitalUsd: config.initialCapitalUsd,
      commission: config.commission,
      slippage: config.slippage,
      dataSource: config.dataSource,
      strategies: [{ strategyType: TREND_FOLLOWING_V1_TYPE, config: { ...strategyConfig, strategyId } }],
      enableRiskChecks: config.enableRiskChecks ?? false,
      maxPositionSizePercent: config.maxPositionSizePercent ?? 10,
      maxDailyLossPercent: config.maxDailyLossPercent ?? 5,
      fillOnClose: true,
      extraIndicatorPeriods: extra,
    };

    const result = await this.engine.run(backtestConfig);
    return result.report;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Grid expansion (Cartesian product)
  // ─────────────────────────────────────────────────────────────────────────

  expandGrid(grid: TfV1ParameterGrid): TfV1ParamCombo[] {
    const axes: Array<[keyof TfV1ParamCombo, number[]]> = [
      ['emaPeriodFast', grid.emaPeriodFast ?? [PARAM_DEFAULTS.emaPeriodFast]],
      ['emaPeriodSlow', grid.emaPeriodSlow ?? [PARAM_DEFAULTS.emaPeriodSlow]],
      ['adxPeriod', grid.adxPeriod ?? [PARAM_DEFAULTS.adxPeriod]],
      ['adxThreshold', grid.adxThreshold ?? [PARAM_DEFAULTS.adxThreshold]],
      ['donchianWindow', grid.donchianWindow ?? [PARAM_DEFAULTS.donchianWindow]],
      ['atrPeriod', grid.atrPeriod ?? [PARAM_DEFAULTS.atrPeriod]],
      ['atrMultiplier', grid.atrMultiplier ?? [PARAM_DEFAULTS.atrMultiplier]],
      ['atrMinThreshold', grid.atrMinThreshold ?? [PARAM_DEFAULTS.atrMinThreshold]],
      ['volumeMaPeriod', grid.volumeMaPeriod ?? [PARAM_DEFAULTS.volumeMaPeriod]],
      ['cooldownCandles', grid.cooldownCandles ?? [PARAM_DEFAULTS.cooldownCandles]],
      ['maxHoldingCandles', grid.maxHoldingCandles ?? [PARAM_DEFAULTS.maxHoldingCandles]],
      ['donchianBreakoutTolerancePct', grid.donchianBreakoutTolerancePct ?? [PARAM_DEFAULTS.donchianBreakoutTolerancePct]],
    ];

    // Cartesian product
    const product = axes.reduce<Array<Partial<TfV1ParamCombo>>>(
      (acc, [key, values]) =>
        acc.flatMap((combo) => values.map((v) => ({ ...combo, [key]: v }))),
      [{}],
    );

    // Filter invalid combos
    return (product as TfV1ParamCombo[]).filter(
      (c) => c.emaPeriodFast < c.emaPeriodSlow && c.emaPeriodFast > 0 && c.emaPeriodSlow > 0,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build the full set of extra indicator periods required by all combos in the grid.
   * Passed to BacktestConfig.extraIndicatorPeriods so the factory creates a superset
   * of calculators that cover every combo's lookups.
   */
  private buildExtraPeriods(grid: TfV1ParameterGrid): ExtraIndicatorPeriods {
    return {
      ema: dedup([...(grid.emaPeriodFast ?? []), ...(grid.emaPeriodSlow ?? [])]),
      atr: dedup(grid.atrPeriod ?? []),
      adx: dedup(grid.adxPeriod ?? []),
      donchian: dedup(grid.donchianWindow ?? []),
      volumeMa: dedup(grid.volumeMaPeriod ?? []),
    };
  }

  /**
   * Infer a safe warmup candle count from the grid's maximum slow-EMA period × 1.5.
   * Guarantees all combos have enough warmup candles for every indicator to be ready.
   */
  private inferWarmupCandles(grid: TfV1ParameterGrid): number {
    const maxSlow = Math.max(...(grid.emaPeriodSlow ?? [PARAM_DEFAULTS.emaPeriodSlow]));
    const maxAdx = Math.max(...(grid.adxPeriod ?? [PARAM_DEFAULTS.adxPeriod]));
    const maxDonchian = Math.max(...(grid.donchianWindow ?? [PARAM_DEFAULTS.donchianWindow]));
    return Math.ceil(Math.max(maxSlow, maxAdx, maxDonchian) * 1.5);
  }

  private buildStrategyConfig(
    params: TfV1ParamCombo,
    sessionSuffix: string,
    config: OptimizationConfig,
  ): StrategyPluginConfig {
    return createTrendFollowingV1Config({
      strategyId: `opt-${sessionSuffix}`,
      name: 'TrendFollowingV1-Optimizer',
      parameters: {
        emaPeriodFast: params.emaPeriodFast,
        emaPeriodSlow: params.emaPeriodSlow,
        adxPeriod: params.adxPeriod,
        adxThreshold: params.adxThreshold,
        donchianWindow: params.donchianWindow,
        atrPeriod: params.atrPeriod,
        atrMultiplier: params.atrMultiplier,
        atrMinThreshold: params.atrMinThreshold,
        volumeMaPeriod: params.volumeMaPeriod,
        cooldownCandles: params.cooldownCandles,
        maxHoldingCandles: params.maxHoldingCandles,
        timeframe: config.timeframe,
        donchianBreakoutTolerancePct: params.donchianBreakoutTolerancePct,
      } satisfies TrendFollowingV1Params,
      enabledSymbols: [config.symbol],
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Redis helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async saveJobStatus(jobId: string, status: OptimizationJobStatus): Promise<void> {
    try {
      await this.redis.getClient().set(this.jobKey(jobId), JSON.stringify(status), 'EX', JOB_TTL_SECONDS);
    } catch (e) {
      this.logger.warn(`Failed to save job status ${jobId}: ${(e as Error).message}`, this.context);
    }
  }

  private async updateProgress(
    jobId: string,
    phase: 'TRAIN' | 'TEST',
    current: number,
    total: number,
    currentParams: TfV1ParamCombo,
  ): Promise<void> {
    const status = await this.getJobStatus(jobId);
    if (!status) return;
    await this.saveJobStatus(jobId, {
      ...status,
      progress: {
        phase,
        current,
        total,
        pct: total > 0 ? Math.round((current / total) * 100) : 0,
        currentParams,
      },
    });
  }

  private async markJobFailed(jobId: string, reason: string): Promise<void> {
    const status = await this.getJobStatus(jobId);
    const now = Date.now();
    await this.saveJobStatus(jobId, {
      ...(status ?? { jobId, startedAt: now, progress: { phase: 'TRAIN', current: 0, total: 0, pct: 0 } }),
      status: 'FAILED',
      completedAt: now,
      error: reason,
    });
  }

  private jobKey(jobId: string): string {
    return `${JOB_KEY_PREFIX}${jobId}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pure utility functions (module-private)
// ─────────────────────────────────────────────────────────────────────────

function toSummary(report: PerformanceReport): PerformanceSummary {
  return {
    totalReturnPercent: report.totalReturnPercent,
    annualizedReturnPercent: report.annualizedReturnPercent,
    sharpeRatio: report.sharpeRatio,
    sortinoRatio: report.sortinoRatio,
    calmarRatio: report.calmarRatio,
    maxDrawdownPercent: report.maxDrawdownPercent,
    totalTrades: report.totalTrades,
    winRate: report.winRate,
    profitFactor: report.profitFactor,
    payoffRatio: report.payoffRatio,
    averageTradeDurationMs: report.averageTradeDurationMs,
    totalCommission: report.totalCommission,
  };
}

function fitness(summary: PerformanceSummary, metric: string): number {
  switch (metric) {
    case 'calmarRatio':    return isFinite(summary.calmarRatio) ? summary.calmarRatio : -Infinity;
    case 'sortinoRatio':   return isFinite(summary.sortinoRatio) ? summary.sortinoRatio : -Infinity;
    case 'profitFactor':   return isFinite(summary.profitFactor) ? summary.profitFactor : -Infinity;
    case 'totalReturnPercent': return summary.totalReturnPercent;
    default:               return isFinite(summary.sharpeRatio) ? summary.sharpeRatio : -Infinity; // sharpeRatio
  }
}

function checkThresholds(
  summary: PerformanceSummary,
  t: Required<AcceptanceThresholds>,
): boolean {
  return (
    summary.sharpeRatio >= t.minSharpe &&
    summary.winRate >= t.minWinRate &&
    summary.profitFactor >= t.minProfitFactor &&
    summary.maxDrawdownPercent <= t.maxDrawdownPct &&
    summary.totalTrades >= t.minTrades
  );
}

function mergeThresholds(overrides?: AcceptanceThresholds): Required<AcceptanceThresholds> {
  return {
    minSharpe: overrides?.minSharpe ?? DEFAULT_THRESHOLDS.minSharpe,
    minWinRate: overrides?.minWinRate ?? DEFAULT_THRESHOLDS.minWinRate,
    minProfitFactor: overrides?.minProfitFactor ?? DEFAULT_THRESHOLDS.minProfitFactor,
    maxDrawdownPct: overrides?.maxDrawdownPct ?? DEFAULT_THRESHOLDS.maxDrawdownPct,
    minTrades: overrides?.minTrades ?? DEFAULT_THRESHOLDS.minTrades,
  };
}

/**
 * Overfit heuristic: the train Sharpe is substantially higher than test Sharpe,
 * and the test Sharpe is too low to be useful in live trading.
 */
function detectOverfit(
  trainSummary: PerformanceSummary,
  testSummary: PerformanceSummary | undefined,
): boolean {
  if (!testSummary) return false;
  return trainSummary.sharpeRatio > testSummary.sharpeRatio * 1.5 && testSummary.sharpeRatio < 0.5;
}

/**
 * Spearman rank correlation between two equal-length arrays.
 * Returns undefined if arrays are too short to be meaningful (< 2 elements).
 */
function computeSpearmanCorrelation(a: number[], b: number[]): number | undefined {
  const n = Math.min(a.length, b.length);
  if (n < 2) return undefined;

  const rankA = toRanks(a.slice(0, n));
  const rankB = toRanks(b.slice(0, n));

  const d2 = rankA.reduce((sum, r, i) => sum + Math.pow(r - rankB[i], 2), 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function toRanks(values: number[]): number[] {
  const sorted = [...values].map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const ranks = new Array<number>(values.length);
  sorted.forEach(({ i }, rank) => { ranks[i] = rank + 1; });
  return ranks;
}

function dedup(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b);
}

/** Yield to the event loop so HTTP requests can be handled between combos. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
