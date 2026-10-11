import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExperimentTrackerService } from './experiment-tracker.service';
import { ResearchDataService } from './research-data.service';
import { PythonBridgeService } from './python-bridge.service';
import { OnnxInferenceService } from './onnx-inference.service';
import { FeatureEngineeringService } from './feature-engineering.service';
import { Experiment } from '../../domain/models/experiment.model';
import {
  ExperimentResult,
  ExperimentMetrics,
  EquityPoint,
  ExperimentTrade,
} from '../../domain/models/experiment-result.model';
import { ResearchDataset } from '../../domain/models/research-dataset.model';
import { MlFramework } from '../../domain/enums/ml-framework.enum';
import { ExperimentStatus } from '../../domain/enums/experiment-status.enum';
import { ResearchPythonBridgeError } from '../../domain/errors/research.errors';
import { randomUUID } from 'crypto';

// ─── Execution Types ──────────────────────────────────────────────────────────

export type SignalValue = 1 | -1 | 0; // BUY / SELL / FLAT

export interface RunOptions {
  /** Override the experiment's own random seed (useful for sensitivity analysis). */
  readonly seedOverride?: number;
  /** Skip writing the result back to storage (dry-run mode). */
  readonly dryRun?: boolean;
}

/**
 * ExperimentRunnerService orchestrates the full lifecycle of a research
 * experiment run:
 *
 *   1. Load dataset via ResearchDataService.
 *   2. Compute features via FeatureEngineeringService (if configured).
 *   3. Dispatch to the appropriate execution backend:
 *        a. TYPESCRIPT_NATIVE  — pure TS signal generation (parameter sweep loop)
 *        b. ONNX               — onnxruntime-node inference
 *        c. PYTHON_TENSORFLOW / PYTHON_PYTORCH — Python bridge subprocess
 *   4. Simulate P&L from the returned signal series.
 *   5. Compute ExperimentMetrics (including statistical validity).
 *   6. Persist results via ExperimentTrackerService.
 *
 * ISOLATION GUARANTEE:
 *   The runner never submits real orders, modifies live positions, or accesses
 *   any production exchange adapter.  All "fills" are simulated using the
 *   configured commission and slippage bps.
 */
@Injectable()
export class ExperimentRunnerService {
  private readonly context = ExperimentRunnerService.name;

  /** Annual risk-free rate (5%) scaled to per-bar in computeMetrics. */
  private static readonly ANNUAL_RF = 0.05;

  constructor(
    private readonly tracker: ExperimentTrackerService,
    private readonly dataService: ResearchDataService,
    private readonly pythonBridge: PythonBridgeService,
    private readonly onnxInference: OnnxInferenceService,
    private readonly featureEngineering: FeatureEngineeringService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Executes an experiment end-to-end and persists the result.
   *
   * @returns  The completed ExperimentResult.
   * @throws   Any error from data loading, signal generation, or storage.
   *           On error: marks experiment as FAILED before rethrowing.
   */
  async run(experimentId: string, options: RunOptions = {}): Promise<ExperimentResult> {
    const experiment = await this.tracker.findById(experimentId);

    if (experiment.status === ExperimentStatus.RUNNING) {
      throw new Error(`Experiment ${experimentId} is already running`);
    }

    await this.tracker.markRunning(experimentId);
    this.logger.log(
      `Experiment run started: id=${experimentId} ` +
        `framework=${experiment.config.mlFramework ?? MlFramework.TYPESCRIPT_NATIVE}`,
      this.context,
    );

    try {
      const dataset = await this.dataService.load(experiment.config.datasetConfig);

      let signals: SignalValue[];
      let rawOutput = '';

      switch (experiment.config.mlFramework ?? MlFramework.TYPESCRIPT_NATIVE) {
        case MlFramework.TYPESCRIPT_NATIVE:
          signals = await this.runNative(experiment, dataset);
          break;

        case MlFramework.ONNX:
          signals = await this.runOnnx(experiment, dataset);
          break;

        case MlFramework.PYTHON_TENSORFLOW:
        case MlFramework.PYTHON_PYTORCH: {
          const pyResult = await this.runPython(experiment, dataset);
          signals = pyResult.signals;
          rawOutput = pyResult.rawOutput;
          break;
        }

        case MlFramework.R:
          throw new Error('R integration is not yet implemented');
      }

      const result = this.buildResult(
        experimentId,
        signals,
        dataset,
        experiment,
        rawOutput,
        options.seedOverride,
      );

      if (!options.dryRun) {
        await this.tracker.markCompleted(experimentId, result);
      }

      this.logger.log(
        `Experiment run completed: id=${experimentId} ` +
          `trades=${result.metrics.tradeCount} ` +
          `sharpe=${result.metrics.sharpeRatio.toFixed(2)} ` +
          `valid=${result.metrics.isStatisticallyValid}`,
        this.context,
      );

      return result;
    } catch (err) {
      await this.tracker.markFailed(experimentId, (err as Error).message);
      throw err;
    }
  }

  // ── Native Runner ─────────────────────────────────────────────────────────

  /**
   * TYPESCRIPT_NATIVE: applies a simple parameter-driven signal rule.
   *
   * Default rule: momentum cross-over using the `fastMa` and `slowMa`
   * parameters from the experiment config.  Researchers override this by
   * subclassing and registering a custom runner factory.
   *
   * Parameters consumed (with defaults):
   *   fastMa   (number, default 10)  — fast SMA window
   *   slowMa   (number, default 30)  — slow SMA window
   *   threshold (number, default 0)  — minimum cross margin to generate signal
   */
  private async runNative(
    experiment: Experiment,
    dataset: ResearchDataset,
  ): Promise<SignalValue[]> {
    const params = experiment.config.parameters;
    const fastWindow = (params['fastMa'] as number | undefined) ?? 10;
    const slowWindow = (params['slowMa'] as number | undefined) ?? 30;
    const threshold = (params['threshold'] as number | undefined) ?? 0;

    const closes = dataset.candles.map((c) => c.close);
    const fastMa = this.sma(closes, fastWindow);
    const slowMa = this.sma(closes, slowWindow);

    return closes.map((_, i) => {
      const f = fastMa[i];
      const s = slowMa[i];
      if (f === undefined || s === undefined || !isFinite(f) || !isFinite(s)) {
        return 0;
      }
      if (f > s * (1 + threshold)) return 1;
      if (f < s * (1 - threshold)) return -1;
      return 0;
    });
  }

  // ── ONNX Runner ───────────────────────────────────────────────────────────

  private async runOnnx(experiment: Experiment, dataset: ResearchDataset): Promise<SignalValue[]> {
    const modelPath = experiment.config.onnxModelPath;
    if (!modelPath) {
      throw new Error('ONNX framework requires onnxModelPath in experiment config');
    }

    // Build feature matrix
    const matrix = experiment.config.featureEngineering
      ? this.featureEngineering.buildMatrix(dataset.candles, experiment.config.featureEngineering)
      : null;

    const inputData = matrix
      ? matrix.data
      : dataset.candles.map((c) => new Float64Array([c.open, c.high, c.low, c.close, c.volume]));

    const batchSize = inputData.length;
    const featureCount = inputData[0]?.length ?? 5;

    // Flatten to Float32Array (ONNX typically expects float32)
    const flat = new Float32Array(batchSize * featureCount);
    for (let i = 0; i < batchSize; i++) {
      for (let j = 0; j < featureCount; j++) {
        flat[i * featureCount + j] = inputData[i]![j] ?? 0;
      }
    }

    const result = await this.onnxInference.run(modelPath, [
      { name: 'input', data: flat, dims: [batchSize, featureCount] },
    ]);

    const output = result.outputs[0];
    if (!output) throw new Error('ONNX model produced no output');

    // Map model outputs to signals: positive → BUY, negative → SELL, near-zero → FLAT
    const deadband = 0.1;
    return Array.from(output.data as Float32Array).map((v) => {
      if (v > deadband) return 1;
      if (v < -deadband) return -1;
      return 0;
    });
  }

  // ── Python Runner ─────────────────────────────────────────────────────────

  private async runPython(
    experiment: Experiment,
    dataset: ResearchDataset,
  ): Promise<{ signals: SignalValue[]; rawOutput: string }> {
    const scriptPath = experiment.config.pythonScriptPath;
    if (!scriptPath) {
      throw new ResearchPythonBridgeError(
        'unknown',
        new Error('PYTHON framework requires pythonScriptPath in experiment config'),
      );
    }

    const requestId = randomUUID();
    const response = await this.pythonBridge.execute({
      requestId,
      script: scriptPath,
      payload: {
        parameters: experiment.config.parameters,
        randomSeed: experiment.randomSeed,
        candles: dataset.candles.map((c) => ({
          t: c.timestampMs,
          o: c.open,
          h: c.high,
          l: c.low,
          c: c.close,
          v: c.volume,
        })),
      },
      timeoutMs: 600_000, // 10 min for heavy training
    });

    if (!response.success || !response.result) {
      throw new ResearchPythonBridgeError(
        scriptPath,
        new Error(response.error ?? 'Python script returned no result'),
      );
    }

    const rawSignals = response.result['signals'] as number[] | undefined;
    if (!Array.isArray(rawSignals)) {
      throw new ResearchPythonBridgeError(
        scriptPath,
        new Error('Python script result must contain a "signals" array of numbers'),
      );
    }

    const signals: SignalValue[] = rawSignals.map((v) => {
      if (v > 0) return 1;
      if (v < 0) return -1;
      return 0;
    });

    return {
      signals,
      rawOutput: (response.logs ?? []).join('\n'),
    };
  }

  // ── P&L Simulation ────────────────────────────────────────────────────────

  private buildResult(
    experimentId: string,
    signals: SignalValue[],
    dataset: ResearchDataset,
    experiment: Experiment,
    rawOutput: string,
    _seedOverride?: number,
  ): ExperimentResult {
    const candles = dataset.candles;
    const n = Math.min(signals.length, candles.length);
    const commissionRate = (experiment.config.commissionBps ?? 10) / 10_000;
    const slippageRate = (experiment.config.slippageBps ?? 5) / 10_000;
    const initialCapital = experiment.config.initialCapitalUsd ?? 10_000;

    let equity = initialCapital;
    let position: SignalValue = 0;
    let entryPrice = 0;
    let entryBar = 0;

    const equityCurve: EquityPoint[] = [];
    const trades: ExperimentTrade[] = [];
    let peakEquity = equity;

    for (let i = 0; i < n; i++) {
      const candle = candles[i]!;
      const signal = signals[i]!;
      const price = candle.close;

      // Signal change → close and/or open position
      if (signal !== position) {
        if (position !== 0 && entryPrice > 0) {
          // Close existing position
          const exitPrice =
            position === 1 ? price * (1 - slippageRate) : price * (1 + slippageRate);
          const qty = 1; // unit position
          const grossPnl = (exitPrice - entryPrice) * position * qty;
          const commission = (Math.abs(grossPnl) + Math.abs(entryPrice)) * commissionRate;
          const slip = Math.abs(exitPrice - price) * qty;
          const netPnl = grossPnl - commission - slip;
          equity += netPnl;

          trades.push({
            entryTimestampMs: candles[entryBar]!.timestampMs,
            exitTimestampMs: candle.timestampMs,
            direction: position === 1 ? 'LONG' : 'SHORT',
            entryPrice,
            exitPrice,
            quantity: qty,
            grossPnl,
            commission,
            slippage: slip,
            netPnl,
            returnPercent: (netPnl / initialCapital) * 100,
            holdingPeriodBars: i - entryBar,
          });
        }

        // Open new position
        if (signal !== 0) {
          entryPrice = signal === 1 ? price * (1 + slippageRate) : price * (1 - slippageRate);
          entryBar = i;
        } else {
          entryPrice = 0;
        }
        position = signal;
      }

      if (equity > peakEquity) peakEquity = equity;
      const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      equityCurve.push({
        timestampMs: candle.timestampMs,
        equity,
        drawdownPercent: drawdownPct,
      });
    }

    const metrics = this.computeMetrics(equityCurve, trades, initialCapital, candles);

    return {
      experimentId,
      metrics,
      equityCurve,
      trades,
      customMetrics: {},
      rawOutput,
      computedAt: new Date(),
    };
  }

  // ── Metrics Computation ───────────────────────────────────────────────────

  private computeMetrics(
    equityCurve: EquityPoint[],
    trades: ExperimentTrade[],
    initialCapital: number,
    candles: ResearchDataset['candles'],
  ): ExperimentMetrics {
    const n = equityCurve.length;
    if (n < 2) {
      return this.zeroMetrics();
    }

    // Daily returns from equity curve
    const returns: number[] = [];
    for (let i = 1; i < n; i++) {
      const prev = equityCurve[i - 1]!.equity;
      const curr = equityCurve[i]!.equity;
      returns.push(prev > 0 ? (curr - prev) / prev : 0);
    }

    const periodsPerYear = this.estimatePeriodsPerYear(candles);
    const rfPerBar = ExperimentRunnerService.ANNUAL_RF / periodsPerYear;

    const meanReturn = this.mean(returns);
    const std = this.std(returns);
    const downstdReturns = returns.filter((r) => r < rfPerBar);
    const downstd = downstdReturns.length > 1 ? this.std(downstdReturns) : std;

    const sharpeRatio = std > 0 ? ((meanReturn - rfPerBar) / std) * Math.sqrt(periodsPerYear) : 0;
    const sortinoRatio =
      downstd > 0 ? ((meanReturn - rfPerBar) / downstd) * Math.sqrt(periodsPerYear) : 0;

    const finalEquity = equityCurve[n - 1]!.equity;
    const totalReturn = (finalEquity - initialCapital) / initialCapital;
    const annualisedReturn = Math.pow(1 + totalReturn, periodsPerYear / n) - 1;

    const maxDrawdown = Math.max(0, ...equityCurve.map((p) => p.drawdownPercent));
    const avgDrawdown = this.mean(equityCurve.map((p) => p.drawdownPercent));

    const calmarRatio = maxDrawdown > 0 ? (annualisedReturn * 100) / maxDrawdown : 0;

    const annualisedVol = std * Math.sqrt(periodsPerYear);
    const cagr = annualisedReturn;

    // Trade stats
    const wins = trades.filter((t) => t.netPnl > 0);
    const losses = trades.filter((t) => t.netPnl <= 0);
    const winRate = trades.length > 0 ? wins.length / trades.length : 0;
    const grossWin = wins.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const avgWinPct = wins.length > 0 ? this.mean(wins.map((t) => t.returnPercent)) : 0;
    const avgLossPct = losses.length > 0 ? this.mean(losses.map((t) => t.returnPercent)) : 0;
    const avgHolding = trades.length > 0 ? this.mean(trades.map((t) => t.holdingPeriodBars)) : 0;
    const expectancy = trades.length > 0 ? this.mean(trades.map((t) => t.netPnl)) : 0;

    // Omega ratio
    const posReturns = returns.filter((r) => r > 0);
    const negReturns = returns.filter((r) => r <= 0);
    const omegaRatio =
      negReturns.length > 0 && Math.abs(this.mean(negReturns)) > 0
        ? this.mean(posReturns.length > 0 ? posReturns : [0]) / Math.abs(this.mean(negReturns))
        : 0;

    // Ulcer index
    const ulcerIndex = Math.sqrt(this.mean(equityCurve.map((p) => p.drawdownPercent ** 2)));

    // Max drawdown duration
    let maxDDDurationDays = 0;
    let ddStart = 0;
    let inDrawdown = false;
    for (let i = 0; i < n; i++) {
      if (equityCurve[i]!.drawdownPercent > 0) {
        if (!inDrawdown) {
          ddStart = i;
          inDrawdown = true;
        }
        const durDays =
          (equityCurve[i]!.timestampMs - equityCurve[ddStart]!.timestampMs) / 86_400_000;
        if (durDays > maxDDDurationDays) maxDDDurationDays = durDays;
      } else {
        inDrawdown = false;
      }
    }

    // Statistical significance: one-tailed t-test H₀: mean return = 0
    const { tStat, pValue, df } = this.welchTTest(returns);

    return {
      totalReturnPercent: totalReturn * 100,
      annualizedReturnPercent: annualisedReturn * 100,
      cagr,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      omegaRatio,
      maxDrawdownPercent: maxDrawdown,
      avgDrawdownPercent: avgDrawdown,
      maxDrawdownDurationDays: maxDDDurationDays,
      ulcerIndex,
      tradeCount: trades.length,
      winRate,
      profitFactor: isFinite(profitFactor) ? profitFactor : 999,
      avgWinPercent: avgWinPct,
      avgLossPercent: avgLossPct,
      avgHoldingPeriodBars: avgHolding,
      expectancy,
      annualizedVolatility: annualisedVol,
      downwardVolatility: downstd * Math.sqrt(periodsPerYear),
      pValue,
      isStatisticallyValid: pValue < 0.05,
      tStatistic: tStat,
      degreesOfFreedom: df,
    };
  }

  // ── Statistical Test ──────────────────────────────────────────────────────

  /**
   * One-sample Welch t-test: H₀: μ = 0 (returns are indistinguishable from zero).
   * Returns the one-tailed p-value, t-statistic, and degrees of freedom.
   */
  private welchTTest(returns: number[]): { tStat: number; pValue: number; df: number } {
    const n = returns.length;
    if (n < 2) return { tStat: 0, pValue: 1, df: 0 };

    const mean = this.mean(returns);
    const se = this.std(returns) / Math.sqrt(n);
    if (se <= 0) return { tStat: 0, pValue: mean > 0 ? 0 : 1, df: n - 1 };

    const tStat = mean / se;
    const df = n - 1;

    // Two-tailed p-value approximation using Student-t CDF (Abramowitz & Stegun 26.7.8)
    const pTwoTail = this.studentTPValue(Math.abs(tStat), df);
    // One-tailed: test that mean > 0
    const pValue = tStat > 0 ? pTwoTail / 2 : 1 - pTwoTail / 2;

    return { tStat, pValue, df };
  }

  /**
   * Approximate two-tailed p-value for Student-t distribution using
   * the incomplete beta function approximation (Peizer & Pratt 1968).
   * Accuracy: ±0.001 for df ≥ 5.
   */
  private studentTPValue(t: number, df: number): number {
    if (df <= 0) return 1;
    // Approximation via normal CDF for large df
    if (df >= 200) {
      return 2 * (1 - this.normalCdf(t));
    }
    // Beta distribution approximation
    const x = df / (df + t * t);
    const a = df / 2;
    const b = 0.5;
    return this.incompleteBeta(x, a, b);
  }

  /** Standard normal CDF via Horner's method (error < 7.5e-8). */
  private normalCdf(z: number): number {
    const p = 0.2316419;
    const b = [0.31938153, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
    const t = 1 / (1 + p * z);
    const poly = b.reduce((acc, bi, i) => acc + bi * Math.pow(t, i + 1), 0);
    return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  }

  /** Regularised incomplete beta function via continued fraction (Lentz). */
  private incompleteBeta(x: number, a: number, b: number): number {
    if (x < 0 || x > 1) return 0;
    if (x === 0 || x === 1) return x;

    const lbeta = this.lgamma(a + b) - this.lgamma(a) - this.lgamma(b);
    const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

    // Continued fraction (Lentz algorithm, up to 200 iterations)
    const STOP = 1e-8;
    let f = 1;
    let C = 1;
    let D = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(D) < 1e-30) D = 1e-30;
    D = 1 / D;
    f = D;

    for (let m = 1; m <= 200; m++) {
      const mf = m;
      // Even step
      let numerator = (mf * (b - mf) * x) / ((a + 2 * mf - 1) * (a + 2 * mf));
      D = 1 + numerator * D;
      if (Math.abs(D) < 1e-30) D = 1e-30;
      C = 1 + numerator / C;
      if (Math.abs(C) < 1e-30) C = 1e-30;
      D = 1 / D;
      f *= C * D;

      // Odd step
      numerator = (-(a + mf) * (a + b + mf) * x) / ((a + 2 * mf) * (a + 2 * mf + 1));
      D = 1 + numerator * D;
      if (Math.abs(D) < 1e-30) D = 1e-30;
      C = 1 + numerator / C;
      if (Math.abs(C) < 1e-30) C = 1e-30;
      D = 1 / D;
      const delta = C * D;
      f *= delta;
      if (Math.abs(delta - 1) < STOP) break;
    }

    return front * f;
  }

  /** log(Γ(z)) via Lanczos approximation (6-coefficient, error < 1e-11). */
  private lgamma(z: number): number {
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
      1.5056327351493116e-7,
    ];
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - this.lgamma(1 - z);
    }
    let x = c[0]!;
    const zz = z - 1;
    for (let i = 1; i < g + 2; i++) {
      x += c[i]! / (zz + i);
    }
    const t = zz + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  private sma(values: number[], window: number): (number | undefined)[] {
    const result: (number | undefined)[] = new Array(values.length).fill(undefined);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i]!;
      if (i >= window) sum -= values[i - window]!;
      if (i >= window - 1) result[i] = sum / window;
    }
    return result;
  }

  private mean(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  private std(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
  }

  private estimatePeriodsPerYear(candles: ResearchDataset['candles']): number {
    if (candles.length < 2) return 252;
    const avgMs =
      (candles[candles.length - 1]!.timestampMs - candles[0]!.timestampMs) / (candles.length - 1);
    return Math.max(1, Math.round((365 * 24 * 3600 * 1000) / avgMs));
  }

  private zeroMetrics(): ExperimentMetrics {
    return {
      totalReturnPercent: 0,
      annualizedReturnPercent: 0,
      cagr: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      omegaRatio: 0,
      maxDrawdownPercent: 0,
      avgDrawdownPercent: 0,
      maxDrawdownDurationDays: 0,
      ulcerIndex: 0,
      tradeCount: 0,
      winRate: 0,
      profitFactor: 0,
      avgWinPercent: 0,
      avgLossPercent: 0,
      avgHoldingPeriodBars: 0,
      expectancy: 0,
      annualizedVolatility: 0,
      downwardVolatility: 0,
      pValue: 1,
      isStatisticallyValid: false,
      tStatistic: 0,
      degreesOfFreedom: 0,
    };
  }
}
