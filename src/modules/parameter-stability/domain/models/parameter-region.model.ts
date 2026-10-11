import { ParameterRegionType } from '../enums/parameter-region-type.enum';

/**
 * A contiguous zone in a 1-D parameter axis (or 2-D slice) that shares a
 * common performance character.
 */
export interface ParameterRegion {
  readonly type: ParameterRegionType;
  /** The parameter(s) this region lives in. */
  readonly paramName: string;
  /** The parameter values (in ascending order) belonging to this region. */
  readonly paramValues: number[];
  /** Metric values observed at each param value in this region. */
  readonly metrics: number[];
  /** Mean metric within the region. */
  readonly meanMetric: number;
  /** Standard deviation of the metric within the region. */
  readonly stdMetric: number;
  /** Human-readable explanation (e.g. "cliff: metric drops 65 % at value 25"). */
  readonly description: string;
}

/** Full report of detected parameter regions across all parameters. */
export interface ParameterRegionReport {
  readonly regions: ParameterRegion[];
  readonly cliffs: ParameterRegion[];
  readonly islands: ParameterRegion[];
  readonly stableRegions: ParameterRegion[];
  readonly unstableRegions: ParameterRegion[];
  /** True when any cliff or island is detected (fragility signals). */
  readonly hasFragilitySignals: boolean;
}
