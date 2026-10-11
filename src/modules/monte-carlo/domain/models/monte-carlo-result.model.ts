import { MonteCarloConfig } from './monte-carlo-config.model';
import { MonteCarloSimulationResult } from './monte-carlo-simulation-result.model';

// ── Statistical helpers ──────────────────────────────────────────────────────

/** Percentile summary for any scalar metric across all simulations. */
export interface DistributionPercentiles {
  readonly p5: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p95: number;
  readonly mean: number;
  readonly stdDev: number;
}

/** One bucket of a frequency histogram. */
export interface HistogramBin {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly count: number;
  /** Relative frequency: count / totalSimulations. */
  readonly frequency: number;
}

// ── Robustness grading ───────────────────────────────────────────────────────

/**
 * Four-tier grading derived from the 0–100 robustness score:
 *   ROBUST    ≥ 80
 *   MODERATE  ≥ 60
 *   FRAGILE   ≥ 40
 *   DANGEROUS < 40
 */
export type RobustnessGrade = 'ROBUST' | 'MODERATE' | 'FRAGILE' | 'DANGEROUS';

// ── Aggregate result ─────────────────────────────────────────────────────────

export interface MonteCarloResult {
  readonly runId: string;
  readonly config: MonteCarloConfig;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly simulationCount: number;

  // ── Probability outputs ────────────────────────────────────────────────
  /** Fraction of paths (0–1) that hit the ruin threshold. */
  readonly probabilityOfRuin: number;

  // ── Statistical distributions (across all N paths) ───────────────────
  readonly returnDistribution: DistributionPercentiles;
  readonly cagrDistribution: DistributionPercentiles;
  readonly drawdownDistribution: DistributionPercentiles;
  readonly sharpeDistribution: DistributionPercentiles;
  readonly sortinoDistribution: DistributionPercentiles;

  // ── Tail-risk metrics ──────────────────────────────────────────────────
  /** 5th-percentile total-return (Value at Risk at 95 % confidence). */
  readonly var95: number;
  /**
   * Conditional VaR — mean total-return of the worst 5 % of paths.
   * Also known as Expected Shortfall (ES).
   */
  readonly cvar95: number;
  /** Ulcer Index computed on the median simulation's equity curve. */
  readonly ulcerIndex: number;
  /** |CVaR| / |median return| — larger means heavier tail vs central outcome. */
  readonly tailRiskRatio: number;

  // ── Named scenarios ────────────────────────────────────────────────────
  readonly worstCase: MonteCarloSimulationResult;
  readonly bestCase: MonteCarloSimulationResult;
  readonly medianCase: MonteCarloSimulationResult;

  // ── Expected values (mean of the distribution) ────────────────────────
  readonly expectedFinalEquity: number;
  readonly expectedMaxDrawdown: number;
  readonly expectedCagr: number;

  // ── Recovery time ──────────────────────────────────────────────────────
  /** Mean number of trades needed to recover from drawdowns, across all paths. */
  readonly averageRecoveryTimeTrades: number;

  // ── Visualisation data ─────────────────────────────────────────────────
  readonly returnHistogram: HistogramBin[];
  readonly drawdownHistogram: HistogramBin[];
  readonly finalEquityHistogram: HistogramBin[];

  // ── 95 % confidence intervals [p2.5, p97.5] ──────────────────────────
  readonly confidenceInterval95Return: readonly [number, number];
  readonly confidenceInterval95Cagr: readonly [number, number];
  readonly confidenceInterval95Drawdown: readonly [number, number];

  // ── Robustness scoring ─────────────────────────────────────────────────
  /** 0–100; higher is more robust. */
  readonly robustnessScore: number;
  readonly robustnessGrade: RobustnessGrade;
  /** true when robustnessScore < 60 (FRAGILE or DANGEROUS). */
  readonly isFragile: boolean;
  /** Human-readable list of penalised risk factors (or confirmation of health). */
  readonly robustnessFactors: string[];
}
