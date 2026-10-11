/** Which performance metric a heatmap visualises. */
export type HeatmapMetric = 'SHARPE' | 'PROFIT' | 'DRAWDOWN' | 'WIN_RATE';

/**
 * One cell in a 2-D parameter heatmap.
 */
export interface HeatmapCell {
  readonly param1Value: number;
  readonly param2Value: number;
  /** Average metric value across all sweep results with this (p1, p2) pair. */
  readonly value: number;
  /** Number of sweep results averaged to produce `value`. */
  readonly count: number;
}

/**
 * A 2-D heatmap showing how a performance metric varies across two parameters.
 */
export interface Heatmap {
  readonly param1Name: string;
  readonly param2Name: string;
  readonly metric: HeatmapMetric;
  /** Cells sorted: outer loop param1 ascending, inner loop param2 ascending. */
  readonly cells: HeatmapCell[];
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  /** Unique sorted values of param1 (rows). */
  readonly param1Values: number[];
  /** Unique sorted values of param2 (columns). */
  readonly param2Values: number[];
}

/** All four heatmaps for a given parameter pair. */
export interface HeatmapSet {
  readonly param1Name: string;
  readonly param2Name: string;
  readonly profit: Heatmap;
  readonly sharpe: Heatmap;
  readonly drawdown: Heatmap;
  readonly winRate: Heatmap;
}
