import { SimulationMethod } from '../enums/simulation-method.enum';

/** Inclusive bps range drawn uniformly at random per trade. */
export interface RandomRangeBps {
  readonly minBps: number;
  readonly maxBps: number;
}

/** Inclusive millisecond range drawn uniformly at random per trade. */
export interface RandomRangeMs {
  readonly minMs: number;
  readonly maxMs: number;
}

export interface MonteCarloConfig {
  readonly runId: string;

  /**
   * Number of Monte Carlo paths to generate.
   * Common presets: 100 | 500 | 1000 | 5000.
   */
  readonly simulationCount: number;

  /** Randomisation technique applied to the original trade list. */
  readonly method: SimulationMethod;

  /** Starting capital used to build each simulated equity curve. */
  readonly initialCapital: number;

  /**
   * Original backtest window boundaries — used only to compute CAGR;
   * the Monte Carlo engine does not re-run the backtest.
   */
  readonly startTime: number;
  readonly endTime: number;

  /**
   * Percentage drop from `initialCapital` that is classified as ruin.
   * E.g. 50 ⇒ a path is ruined once equity falls 50 % below start.
   */
  readonly ruinThresholdPercent: number;

  // ── Execution-cost perturbations (MONTE_CARLO_FULL only) ────────────────
  /** Additional random slippage in bps applied per trade. */
  readonly randomSlippage?: RandomRangeBps;

  /**
   * Random execution latency per trade.
   * Approximated as price impact: 1 ms ≈ 0.001 bps additional slippage.
   */
  readonly randomLatency?: RandomRangeMs;

  /** Replaces the recorded commission with a random value in this bps range. */
  readonly randomCommission?: RandomRangeBps;

  /** Random bid-ask spread cost added per trade (entry + exit combined). */
  readonly randomSpread?: RandomRangeBps;

  /**
   * Fixed seed for reproducible runs.
   * Omit (or undefined) to use the platform PRNG — non-deterministic.
   */
  readonly seed?: number;
}
