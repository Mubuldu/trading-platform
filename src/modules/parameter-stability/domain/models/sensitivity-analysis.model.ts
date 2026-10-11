/**
 * One point on a marginal sensitivity curve: the average performance of all
 * sweep combinations that use a specific value for parameter `paramName`.
 */
export interface SensitivityPoint {
  /** The concrete parameter value at this point. */
  readonly paramValue: number;
  /** Mean metric (e.g. Sharpe) across all combinations with this param value. */
  readonly meanMetric: number;
  /** Standard deviation of the metric across those combinations. */
  readonly stdMetric: number;
  /** How many sweep results contributed to this point. */
  readonly count: number;
}

/**
 * Full marginal-sensitivity curve for one parameter.
 *
 * The curve is derived by averaging the target metric over all other parameters
 * ("marginal averaging"), which measures how much the metric changes as this
 * parameter varies while all other effects are integrated out.
 */
export interface SensitivityCurve {
  readonly paramName: string;
  /** Metric value when this parameter is at its median value. */
  readonly baselineMetric: number;
  /** Points sorted ascending by paramValue. */
  readonly points: SensitivityPoint[];
  /**
   * Normalised sensitivity index: (max − min) / |baseline|.
   * A value > 0.5 indicates the metric swings by more than 50 % of the
   * baseline as the parameter moves across its range.
   */
  readonly sensitivity: number;
  /** True when sensitivity > 0.5 (heuristic threshold). */
  readonly isSensitive: boolean;
}

/** Complete sensitivity analysis report across all parameters. */
export interface SensitivityAnalysisReport {
  readonly curves: Record<string, SensitivityCurve>;
  /** Names of parameters whose `isSensitive` flag is true. */
  readonly sensitiveParams: string[];
  /** Fraction of parameters classified as insensitive (0–1). */
  readonly overallRobustness: number;
}
