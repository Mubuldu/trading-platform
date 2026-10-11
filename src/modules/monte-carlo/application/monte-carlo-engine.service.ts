import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { RandomGenerator } from '@shared/random/random-generator.interface';
import { CryptoRandomGenerator, SeededRandomGenerator } from '@shared/random/random-generator';
import { SimulationMethod } from '../domain/enums/simulation-method.enum';
import { MonteCarloConfig } from '../domain/models/monte-carlo-config.model';
import {
  DistributionPercentiles,
  MonteCarloResult,
} from '../domain/models/monte-carlo-result.model';
import { MonteCarloSimulationResult } from '../domain/models/monte-carlo-simulation-result.model';
import { BootstrapResamplerService } from './bootstrap-resampler.service';
import { TradeRandomizerService } from './trade-randomizer.service';
import { SimulationRunnerService } from './simulation-runner.service';
import { StatisticsAggregatorService } from './statistics-aggregator.service';
import { RobustnessScorerService } from './robustness-scorer.service';

/**
 * MonteCarloEngineService
 *
 * Orchestrates the Monte Carlo simulation pipeline:
 *
 *   1. Select RNG (seeded for reproducibility or crypto for production).
 *   2. For each of N simulations:
 *      a. Build a randomised trade sequence via the configured method.
 *      b. Run the equity curve simulation and collect per-path metrics.
 *   3. Aggregate all simulation results into a statistical summary.
 *   4. Score the strategy's robustness (0–100) and assign a grade.
 *
 * This service is synchronous; individual simulations are O(trades) and the
 * entire engine runs in O(N × trades) time.  For N=5000 / trades=500 this is
 * roughly 2.5 M iterations — comfortably sub-second in Node.js.
 */
@Injectable()
export class MonteCarloEngineService {
  private readonly context = MonteCarloEngineService.name;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly resampler: BootstrapResamplerService,
    private readonly randomizer: TradeRandomizerService,
    private readonly runner: SimulationRunnerService,
    private readonly aggregator: StatisticsAggregatorService,
    private readonly scorer: RobustnessScorerService,
  ) {}

  /**
   * Runs all Monte Carlo simulations and returns the aggregated result.
   *
   * @param trades  Completed trade list from a prior backtest run.
   * @param config  Simulation parameters.
   */
  run(trades: TradeRecord[], config: MonteCarloConfig): MonteCarloResult {
    const startedAt = Date.now();

    this.logger.log(
      `Monte Carlo ${config.runId}: method=${config.method}, ` +
        `simulations=${config.simulationCount}, trades=${trades.length}`,
      this.context,
    );

    if (trades.length === 0) {
      this.logger.warn(
        `Monte Carlo ${config.runId}: trade list is empty — returning null result`,
        this.context,
      );
      return this.buildEmptyResult(config, startedAt);
    }

    const rng: RandomGenerator =
      config.seed !== undefined
        ? new SeededRandomGenerator(config.seed)
        : new CryptoRandomGenerator();

    // ── Run all simulations ─────────────────────────────────────────────
    const simulations: MonteCarloSimulationResult[] = [];

    for (let i = 0; i < config.simulationCount; i++) {
      const sequence = this.buildSequence(trades, config, rng);
      simulations.push(this.runner.run(i, sequence, config));
    }

    // ── Aggregate ───────────────────────────────────────────────────────
    return this.aggregate(config, simulations, startedAt);
  }

  // ── Private: sequence construction ──────────────────────────────────────

  private buildSequence(
    trades: TradeRecord[],
    config: MonteCarloConfig,
    rng: RandomGenerator,
  ): TradeRecord[] {
    switch (config.method) {
      case SimulationMethod.BOOTSTRAP_RESAMPLING:
        return this.resampler.resample(trades, rng);

      case SimulationMethod.RANDOM_TRADE_ORDER:
        return rng.shuffle([...trades]);

      case SimulationMethod.MONTE_CARLO_FULL: {
        // Bootstrap first → randomise costs → return perturbed sequence.
        const resampled = this.resampler.resample(trades, rng);
        return resampled.map((t) => this.randomizer.applyRandomization(t, config, rng));
      }

      default:
        return [...trades];
    }
  }

  // ── Private: aggregation ─────────────────────────────────────────────────

  private aggregate(
    config: MonteCarloConfig,
    simulations: MonteCarloSimulationResult[],
    startedAt: number,
  ): MonteCarloResult {
    const completedAt = Date.now();
    const n = simulations.length;

    // ── Ruin probability ──────────────────────────────────────────────────
    const probabilityOfRuin = simulations.filter((s) => s.isRuin).length / n;

    // ── Raw metric arrays ─────────────────────────────────────────────────
    const returns = simulations.map((s) => s.totalReturnPercent);
    const cagrs = simulations.map((s) => s.cagrPercent);
    const drawdowns = simulations.map((s) => s.maxDrawdownPercent);
    const sharpes = simulations.map((s) => s.sharpeRatio);
    const sortinos = simulations.map((s) => s.sortinoRatio);
    const finalEquities = simulations.map((s) => s.finalEquity);

    // ── Percentile distributions ──────────────────────────────────────────
    const returnDistribution = this.aggregator.computePercentiles(returns);
    const cagrDistribution = this.aggregator.computePercentiles(cagrs);
    const drawdownDistribution = this.aggregator.computePercentiles(drawdowns);
    const sharpeDistribution = this.aggregator.computePercentiles(sharpes);
    const sortinoDistribution = this.aggregator.computePercentiles(sortinos);

    // ── Tail risk ─────────────────────────────────────────────────────────
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95 = this.aggregator.computeVar95(sortedReturns);
    const cvar95 = this.aggregator.computeCvar95(sortedReturns);

    const medianSim = this.findMedian(simulations);
    const ulcerIndex = this.aggregator.computeUlcerIndex(medianSim.equityCurve);

    const tailRiskRatio =
      returnDistribution.median !== 0 ? Math.abs(cvar95) / Math.abs(returnDistribution.median) : 0;

    // ── Named scenarios ───────────────────────────────────────────────────
    const sortedByReturn = [...simulations].sort(
      (a, b) => a.totalReturnPercent - b.totalReturnPercent,
    );
    const worstCase = sortedByReturn[0];
    const bestCase = sortedByReturn[sortedByReturn.length - 1];
    const medianCase = medianSim;

    // ── Expected values ───────────────────────────────────────────────────
    const expectedFinalEquity = finalEquities.reduce((s, e) => s + e, 0) / n;
    const expectedMaxDrawdown = drawdownDistribution.mean;
    const expectedCagr = cagrDistribution.mean;

    // ── Recovery time ─────────────────────────────────────────────────────
    const averageRecoveryTimeTrades = this.aggregator.computeAverageRecoveryTime(simulations);

    // ── Histograms ─────────────────────────────────────────────────────────
    const returnHistogram = this.aggregator.buildHistogram(returns);
    const drawdownHistogram = this.aggregator.buildHistogram(drawdowns);
    const finalEquityHistogram = this.aggregator.buildHistogram(finalEquities);

    // ── 95 % CIs [p2.5, p97.5] ───────────────────────────────────────────
    const sortedCagrs = [...cagrs].sort((a, b) => a - b);
    const sortedDrawdowns = [...drawdowns].sort((a, b) => a - b);

    const confidenceInterval95Return: readonly [number, number] = [
      this.aggregator.interpolatedPercentile(sortedReturns, 2.5),
      this.aggregator.interpolatedPercentile(sortedReturns, 97.5),
    ];
    const confidenceInterval95Cagr: readonly [number, number] = [
      this.aggregator.interpolatedPercentile(sortedCagrs, 2.5),
      this.aggregator.interpolatedPercentile(sortedCagrs, 97.5),
    ];
    const confidenceInterval95Drawdown: readonly [number, number] = [
      this.aggregator.interpolatedPercentile(sortedDrawdowns, 2.5),
      this.aggregator.interpolatedPercentile(sortedDrawdowns, 97.5),
    ];

    // ── Robustness score ──────────────────────────────────────────────────
    const robustness = this.scorer.score(
      probabilityOfRuin,
      returnDistribution,
      drawdownDistribution,
      sharpeDistribution,
      var95,
      cvar95,
    );

    this.logger.log(
      `Monte Carlo ${config.runId} completed in ${completedAt - startedAt} ms: ` +
        `ruin=${(probabilityOfRuin * 100).toFixed(1)} %, ` +
        `medianReturn=${returnDistribution.median.toFixed(1)} %, ` +
        `medianDD=${drawdownDistribution.median.toFixed(1)} %, ` +
        `VaR95=${var95.toFixed(1)} %, CVaR95=${cvar95.toFixed(1)} %, ` +
        `score=${robustness.score} (${robustness.grade})`,
      this.context,
    );

    return {
      runId: config.runId,
      config,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      simulationCount: n,
      probabilityOfRuin,
      returnDistribution,
      cagrDistribution,
      drawdownDistribution,
      sharpeDistribution,
      sortinoDistribution,
      var95,
      cvar95,
      ulcerIndex,
      tailRiskRatio,
      worstCase,
      bestCase,
      medianCase,
      expectedFinalEquity,
      expectedMaxDrawdown,
      expectedCagr,
      averageRecoveryTimeTrades,
      returnHistogram,
      drawdownHistogram,
      finalEquityHistogram,
      confidenceInterval95Return,
      confidenceInterval95Cagr,
      confidenceInterval95Drawdown,
      robustnessScore: robustness.score,
      robustnessGrade: robustness.grade,
      isFragile: robustness.isFragile,
      robustnessFactors: robustness.factors,
    };
  }

  // ── Private: helpers ─────────────────────────────────────────────────────

  /**
   * Returns the simulation whose totalReturnPercent is closest to the median
   * of all simulations.
   */
  private findMedian(simulations: MonteCarloSimulationResult[]): MonteCarloSimulationResult {
    const sorted = [...simulations].sort((a, b) => a.totalReturnPercent - b.totalReturnPercent);
    return sorted[Math.floor(sorted.length / 2)];
  }

  // ── Private: empty result ────────────────────────────────────────────────

  private buildEmptyResult(config: MonteCarloConfig, startedAt: number): MonteCarloResult {
    const completedAt = Date.now();
    const emptyDist: DistributionPercentiles = {
      p5: 0,
      p25: 0,
      median: 0,
      p75: 0,
      p95: 0,
      mean: 0,
      stdDev: 0,
    };
    const emptySim: MonteCarloSimulationResult = {
      simulationIndex: 0,
      finalEquity: config.initialCapital,
      totalReturnPercent: 0,
      cagrPercent: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      isRuin: false,
      tradeCount: 0,
      equityCurve: [config.initialCapital],
    };

    return {
      runId: config.runId,
      config,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      simulationCount: 0,
      probabilityOfRuin: 0,
      returnDistribution: emptyDist,
      cagrDistribution: emptyDist,
      drawdownDistribution: emptyDist,
      sharpeDistribution: emptyDist,
      sortinoDistribution: emptyDist,
      var95: 0,
      cvar95: 0,
      ulcerIndex: 0,
      tailRiskRatio: 0,
      worstCase: emptySim,
      bestCase: emptySim,
      medianCase: emptySim,
      expectedFinalEquity: config.initialCapital,
      expectedMaxDrawdown: 0,
      expectedCagr: 0,
      averageRecoveryTimeTrades: 0,
      returnHistogram: [],
      drawdownHistogram: [],
      finalEquityHistogram: [],
      confidenceInterval95Return: [0, 0],
      confidenceInterval95Cagr: [0, 0],
      confidenceInterval95Drawdown: [0, 0],
      robustnessScore: 0,
      robustnessGrade: 'DANGEROUS',
      isFragile: true,
      robustnessFactors: ['No trades provided'],
    };
  }
}
