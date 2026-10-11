import { Injectable } from '@nestjs/common';
import { OverfittingReport } from '../domain/models/overfitting-report.model';
import { SweepResultEntry } from '../domain/models/sweep-result.model';
import { DeflatedSharpeService } from './deflated-sharpe.service';
import { HeatmapGeneratorService } from './heatmap-generator.service';
import { ParameterRegionDetectorService } from './parameter-region-detector.service';
import { ProbabilisticSharpeService } from './probabilistic-sharpe.service';
import { SensitivityAnalyzerService } from './sensitivity-analyzer.service';
import { StrategyHealthScorerService } from './strategy-health-scorer.service';

export interface OverfittingDetectorInput {
  /**
   * All evaluated parameter combinations with their observed metrics.
   * Produced by a grid or random search followed by backtesting.
   */
  readonly sweepResults: SweepResultEntry[];
  /**
   * Per-period return series of the BEST combination (e.g. daily returns).
   * Used by PSR and DSR to assess statistical significance.
   */
  readonly bestReturns: number[];
  /**
   * Benchmark Sharpe ratio for the PSR test (default 0 = "beats zero").
   */
  readonly benchmarkSharpe?: number;
}

/**
 * OverfittingDetectorService
 *
 * Orchestrates the full parameter-stability / over-fitting detection pipeline:
 *
 *   1. Sensitivity analysis   — how much does performance change per parameter?
 *   2. Heatmap generation     — 2-D views of metric surfaces
 *   3. PSR                    — is the observed Sharpe statistically significant?
 *   4. DSR                    — is the Sharpe significant after correcting for
 *                               the number of tested combinations?
 *   5. Parameter region detection — cliffs, islands, stable/unstable zones
 *   6. Strategy health score  — A+ … F composite grade
 *
 * The `isOverfit` flag fires when ≥ 2 of the five canonical signals are active:
 *   Signal 1: DSR < 0.95   (data-mining bias)
 *   Signal 2: PSR < 0.95   (Sharpe statistically insignificant vs. zero)
 *   Signal 3: fragility signals detected (cliffs or islands)
 *   Signal 4: health grade is D or F (numericScore < 50)
 *   Signal 5: > 50 % of parameters are sensitive
 */
@Injectable()
export class OverfittingDetectorService {
  constructor(
    private readonly sensitivityAnalyzer: SensitivityAnalyzerService,
    private readonly heatmapGenerator: HeatmapGeneratorService,
    private readonly psrService: ProbabilisticSharpeService,
    private readonly dsrService: DeflatedSharpeService,
    private readonly regionDetector: ParameterRegionDetectorService,
    private readonly healthScorer: StrategyHealthScorerService,
  ) {}

  analyze(input: OverfittingDetectorInput): OverfittingReport {
    const { sweepResults, bestReturns, benchmarkSharpe = 0 } = input;

    // ── 1. Sensitivity analysis ──────────────────────────────────────────────
    const sensitivityAnalysis = this.sensitivityAnalyzer.analyze(sweepResults);

    // ── 2. Heatmaps ──────────────────────────────────────────────────────────
    const heatmapSets = this.heatmapGenerator.generateAll(sweepResults);

    // ── 3. PSR ───────────────────────────────────────────────────────────────
    const probabilisticSharpe = this.psrService.compute(bestReturns, benchmarkSharpe);

    // ── 4. DSR ───────────────────────────────────────────────────────────────
    const allSweepSharpes = sweepResults.map((r) => r.metrics.sharpe);
    const deflatedSharpe = this.dsrService.compute(bestReturns, allSweepSharpes);

    // ── 5. Region detection ──────────────────────────────────────────────────
    const parameterRegions = this.regionDetector.detect(sweepResults);

    // ── 6. Health score ──────────────────────────────────────────────────────
    const healthScore = this.healthScorer.score(
      sensitivityAnalysis,
      probabilisticSharpe,
      deflatedSharpe,
      parameterRegions,
    );

    // ── Overfitting signal counting ──────────────────────────────────────────
    const signals: boolean[] = [
      !deflatedSharpe.isSignificant, // Signal 1: DSR
      !probabilisticSharpe.isSignificant, // Signal 2: PSR
      parameterRegions.hasFragilitySignals, // Signal 3: regions
      healthScore.numericScore < 50, // Signal 4: grade D/F
      sensitivityAnalysis.overallRobustness < 0.5, // Signal 5: sensitivity
    ];
    const signalCount = signals.filter(Boolean).length;
    const isOverfit = signalCount >= 2;

    // ── Warnings & recommendations ───────────────────────────────────────────
    const warnings = this.buildWarnings(
      input,
      signals,
      parameterRegions.regions.map((r) => r.description),
    );
    const recommendations = this.buildRecommendations(signals, sensitivityAnalysis.sensitiveParams);

    return {
      isOverfit,
      signalCount,
      healthScore,
      deflatedSharpe,
      probabilisticSharpe,
      sensitivityAnalysis,
      heatmapSets,
      parameterRegions,
      warnings,
      recommendations,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildWarnings(
    input: OverfittingDetectorInput,
    signals: boolean[],
    regionDescriptions: string[],
  ): string[] {
    const w: string[] = [];
    const N = input.sweepResults.length;

    if (signals[0])
      w.push(`DSR test failed: Sharpe is consistent with luck across ${N} tested combinations`);
    if (signals[1])
      w.push(`PSR test failed: Sharpe ratio is not statistically significant (p < 0.95)`);
    if (signals[2]) {
      for (const d of regionDescriptions.filter(
        (s) => s.toLowerCase().includes('cliff') || s.toLowerCase().includes('island'),
      )) {
        w.push(d);
      }
    }
    if (signals[3]) w.push(`Strategy health score is below passing threshold (grade D or F)`);
    if (signals[4])
      w.push(`Majority of parameters are highly sensitive — strategy performance is fragile`);

    return w;
  }

  private buildRecommendations(signals: boolean[], sensitiveParams: string[]): string[] {
    const r: string[] = [];

    if (signals[0] || signals[1]) {
      r.push('Extend the backtest period to improve statistical power before deploying');
    }
    if (signals[0]) {
      r.push('Reduce the number of optimised parameters (fewer trials → smaller DSR penalty)');
    }
    if (signals[2]) {
      r.push('Investigate parameter cliffs and islands; test with parameter values on both sides');
    }
    if (signals[4] && sensitiveParams.length > 0) {
      r.push(
        `Anchor sensitive parameters (${sensitiveParams.join(', ')}) at their best values and ` +
          `verify performance holds across a ±20 % perturbation range`,
      );
    }
    if (signals[3]) {
      r.push(
        'Consider simplifying the strategy by removing parameters with low marginal information',
      );
    }

    return r.length > 0
      ? r
      : ['No critical overfitting signals detected — continue monitoring on live data'];
  }
}
