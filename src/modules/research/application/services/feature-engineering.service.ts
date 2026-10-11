import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  FeatureDefinition,
  FeatureEngineeringConfig,
  FeatureTransform,
} from '../../domain/models/experiment.model';
import { ResearchCandle } from '../../domain/models/research-dataset.model';
import { ResearchInsufficientDataError } from '../../domain/errors/research.errors';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FeatureRow = Record<string, number>;

export interface FeatureMatrix {
  /** Column names in the same order as `data[n]` arrays. */
  readonly columns: string[];
  /** Row-major: data[rowIndex][colIndex]. */
  readonly data: Float64Array[];
  /** Unix millisecond timestamps aligned to each row. */
  readonly timestamps: number[];
  readonly rowCount: number;
  readonly warmupBarsDropped: number;
}

/**
 * Base source columns automatically available to feature definitions
 * (no indicator required — derived directly from candles).
 */
const BASE_SOURCES = new Set([
  'open',
  'high',
  'low',
  'close',
  'volume',
  'hl2', // (high + low) / 2
  'hlc3', // (high + low + close) / 3
  'ohlc4', // (open + high + low + close) / 4
  'log_close', // ln(close)
]);

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * FeatureEngineeringService transforms raw OHLCV data into machine-learning
 * feature matrices according to a declarative FeatureEngineeringConfig.
 *
 * Supported transforms (all zero-lookahead, computed only from past bars):
 *   ZSCORE    — rolling (x - μ) / σ
 *   MIN_MAX   — rolling (x - min) / (max - min)
 *   LOG_RETURN — log(close[t] / close[t-1])
 *   PCT_CHANGE — (x[t] - x[t-1]) / x[t-1]
 *   DIFF      — x[t] - x[t-1]
 *   RANK      — percentile rank in rolling window (0..1)
 *   NONE      — raw value pass-through
 *
 * Features may optionally be lagged (e.g. lag=1 uses the value from the
 * previous bar), which is essential to prevent lookahead bias.
 */
@Injectable()
export class FeatureEngineeringService {
  private readonly context = FeatureEngineeringService.name;

  constructor(private readonly logger: AppLoggerService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Compute the feature matrix from candles and an optional indicator value map.
   *
   * @param candles         Raw OHLCV bars in ascending time order.
   * @param config          Feature engineering pipeline configuration.
   * @param indicatorValues Optional pre-computed indicator series keyed by name.
   *                        Must have the same length as `candles`.
   */
  buildMatrix(
    candles: ResearchCandle[],
    config: FeatureEngineeringConfig,
    indicatorValues: Record<string, number[]> = {},
  ): FeatureMatrix {
    if (candles.length === 0) {
      throw new ResearchInsufficientDataError(1, 0, 'feature engineering');
    }

    // Derive base column vectors
    const base = this.deriveBaseColumns(candles);
    const sources: Record<string, number[]> = { ...base, ...indicatorValues };

    // Compute each feature column
    const featureCols: Record<string, number[]> = {};
    for (const def of config.features) {
      const raw = this.resolveSource(sources, def.source, candles.length);
      const transformed = this.applyTransform(raw, def);
      featureCols[def.name] = transformed;
    }

    // Drop warm-up bars and NaN rows
    const skipBars = config.warmupBars;
    const columns = config.features.map((f) => f.name);
    const rows: Float64Array[] = [];
    const timestamps: number[] = [];

    for (let i = skipBars; i < candles.length; i++) {
      const row = new Float64Array(columns.length);
      let hasNaN = false;
      for (let c = 0; c < columns.length; c++) {
        const v = featureCols[columns[c]]![i] ?? NaN;
        if (!isFinite(v)) {
          hasNaN = true;
          break;
        }
        row[c] = v;
      }
      if (!hasNaN) {
        rows.push(row);
        timestamps.push(candles[i]!.timestampMs);
      }
    }

    this.logger.debug?.(
      `Feature engineering: ${rows.length} rows × ${columns.length} cols ` +
        `(${skipBars} warmup bars dropped)`,
      this.context,
    );

    return {
      columns,
      data: rows,
      timestamps,
      rowCount: rows.length,
      warmupBarsDropped: skipBars,
    };
  }

  /** Returns a flat array of feature names that will be in the matrix. */
  getColumnNames(config: FeatureEngineeringConfig): string[] {
    return config.features.map((f) => f.name);
  }

  // ── Base Columns ──────────────────────────────────────────────────────────

  private deriveBaseColumns(candles: ResearchCandle[]): Record<string, number[]> {
    const n = candles.length;
    const open = new Array<number>(n);
    const high = new Array<number>(n);
    const low = new Array<number>(n);
    const close = new Array<number>(n);
    const volume = new Array<number>(n);
    const hl2 = new Array<number>(n);
    const hlc3 = new Array<number>(n);
    const ohlc4 = new Array<number>(n);
    const logClose = new Array<number>(n);

    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      open[i] = c.open;
      high[i] = c.high;
      low[i] = c.low;
      close[i] = c.close;
      volume[i] = c.volume;
      hl2[i] = (c.high + c.low) / 2;
      hlc3[i] = (c.high + c.low + c.close) / 3;
      ohlc4[i] = (c.open + c.high + c.low + c.close) / 4;
      logClose[i] = Math.log(c.close);
    }

    return { open, high, low, close, volume, hl2, hlc3, ohlc4, log_close: logClose };
  }

  // ── Source Resolution ─────────────────────────────────────────────────────

  private resolveSource(
    sources: Record<string, number[]>,
    sourceName: string,
    length: number,
  ): number[] {
    if (sources[sourceName]) return sources[sourceName]!;
    // If the source is not found, return NaN array (downstream handles it)
    this.logger.warn(
      `Feature source '${sourceName}' not found — will produce NaN values`,
      this.context,
    );
    return new Array<number>(length).fill(NaN);
  }

  // ── Transforms ────────────────────────────────────────────────────────────

  private applyTransform(raw: number[], def: FeatureDefinition): number[] {
    const { transform, window, lag } = def;
    let result = this.computeTransform(raw, transform, window ?? 20);

    if (lag && lag > 0) {
      result = this.applyLag(result, lag);
    }

    return result;
  }

  private computeTransform(
    values: number[],
    transform: FeatureTransform,
    window: number,
  ): number[] {
    switch (transform) {
      case 'NONE':
        return [...values];
      case 'LOG_RETURN':
        return this.logReturn(values);
      case 'PCT_CHANGE':
        return this.pctChange(values);
      case 'DIFF':
        return this.diff(values);
      case 'ZSCORE':
        return this.rollingZscore(values, window);
      case 'MIN_MAX':
        return this.rollingMinMax(values, window);
      case 'RANK':
        return this.rollingRank(values, window);
    }
  }

  // ── Transform Implementations ─────────────────────────────────────────────

  private logReturn(values: number[]): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1]!;
      const curr = values[i]!;
      result[i] = prev > 0 && curr > 0 ? Math.log(curr / prev) : NaN;
    }
    return result;
  }

  private pctChange(values: number[]): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1]!;
      result[i] = prev !== 0 ? (values[i]! - prev) / Math.abs(prev) : NaN;
    }
    return result;
  }

  private diff(values: number[]): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = 1; i < values.length; i++) {
      result[i] = values[i]! - values[i - 1]!;
    }
    return result;
  }

  private rollingZscore(values: number[], window: number): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = window - 1; i < values.length; i++) {
      const slice = values.slice(i - window + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / window;
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / window;
      const std = Math.sqrt(variance);
      result[i] = std > 0 ? (values[i]! - mean) / std : 0;
    }
    return result;
  }

  private rollingMinMax(values: number[], window: number): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = window - 1; i < values.length; i++) {
      const slice = values.slice(i - window + 1, i + 1);
      const min = Math.min(...slice);
      const max = Math.max(...slice);
      const range = max - min;
      result[i] = range > 0 ? (values[i]! - min) / range : 0;
    }
    return result;
  }

  private rollingRank(values: number[], window: number): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = window - 1; i < values.length; i++) {
      const slice = values.slice(i - window + 1, i + 1);
      const current = values[i]!;
      const rank = slice.filter((v) => v <= current).length / window;
      result[i] = rank;
    }
    return result;
  }

  private applyLag(values: number[], lag: number): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = lag; i < values.length; i++) {
      result[i] = values[i - lag]!;
    }
    return result;
  }

  // ── Static Utility ────────────────────────────────────────────────────────

  /**
   * Returns true if the source name is a built-in base column.
   * Custom sources (indicators) are looked up from the indicatorValues map.
   */
  static isBaseSource(sourceName: string): boolean {
    return BASE_SOURCES.has(sourceName);
  }
}
