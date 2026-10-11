import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ResearchCandle } from '../../domain/models/research-dataset.model';
import { ResearchInsufficientDataError } from '../../domain/errors/research.errors';

// ─── Enums & Types ─────────────────────────────────────────────────────────────

export enum MarketRegime {
  /** Strong uptrend with low volatility. */
  BULL_QUIET = 'BULL_QUIET',
  /** Strong uptrend with high volatility. */
  BULL_VOLATILE = 'BULL_VOLATILE',
  /** Downtrend with low volatility. */
  BEAR_QUIET = 'BEAR_QUIET',
  /** Downtrend with high volatility (crash/panic). */
  BEAR_VOLATILE = 'BEAR_VOLATILE',
  /** Sideways / range-bound with low volatility. */
  SIDEWAYS_QUIET = 'SIDEWAYS_QUIET',
  /** Sideways / range-bound with high volatility (choppy). */
  SIDEWAYS_VOLATILE = 'SIDEWAYS_VOLATILE',
}

export enum TrendState {
  BULL = 'BULL',
  BEAR = 'BEAR',
  SIDEWAYS = 'SIDEWAYS',
}

export enum VolatilityState {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface RegimeBar {
  readonly timestampMs: number;
  readonly regime: MarketRegime;
  readonly trend: TrendState;
  readonly volatility: VolatilityState;
  /** Annualised realised volatility at this bar. */
  readonly realisedVolAnnualised: number;
  /** Distance from current price to long-term trend MA, normalised by price. */
  readonly trendDeviation: number;
  /** Hurst exponent estimate over the lookback window (>0.5 = trending, <0.5 = mean-reverting). */
  readonly hurstExponent: number;
}

export interface RegimeDetectionResult {
  readonly regimes: RegimeBar[];
  /** Proportion of bars in each regime (0..1). */
  readonly regimeDistribution: Record<MarketRegime, number>;
  /** Number of distinct regime transitions. */
  readonly transitionCount: number;
  /** Average duration of each regime in bars. */
  readonly avgRegimeDurationBars: number;
  readonly computedAt: Date;
}

export interface RegimeDetectionConfig {
  /** Short-term trend MA window. Default: 20. */
  readonly shortMaWindow?: number;
  /** Long-term trend MA window. Default: 100. */
  readonly longMaWindow?: number;
  /** Volatility lookback (bars). Default: 20. */
  readonly volWindow?: number;
  /**
   * High volatility threshold: annualised vol above this → HIGH.
   * Default: 0.80 (80%).
   */
  readonly highVolThreshold?: number;
  /**
   * Low volatility threshold: annualised vol below this → LOW.
   * Default: 0.30 (30%).
   */
  readonly lowVolThreshold?: number;
  /**
   * Trend deviation threshold: |price - LT_MA| / LT_MA above this → trending.
   * Default: 0.05 (5%).
   */
  readonly trendDeviationThreshold?: number;
  /** Hurst window for R/S calculation. Default: 40. */
  readonly hurstWindow?: number;
}

/**
 * MarketRegimeDetectorService classifies market conditions into six regimes
 * using trend, volatility, and Hurst exponent signals.
 *
 * Algorithm:
 *   1. Trend: SMA crossover (short MA vs long MA) + trend deviation.
 *      Bull if short_MA > long_MA and deviation > threshold.
 *      Bear if short_MA < long_MA and deviation > threshold.
 *      Sideways otherwise.
 *
 *   2. Volatility: realised volatility (rolling std of log returns, annualised).
 *      Thresholds split into LOW / MEDIUM / HIGH.
 *
 *   3. Hurst exponent via rescaled-range (R/S) analysis:
 *      H > 0.55 → trending; H < 0.45 → mean-reverting; else random walk.
 *      Used to refine trend signal.
 *
 *   4. Combine into 6 regimes: {BULL, BEAR, SIDEWAYS} × {QUIET, VOLATILE}.
 */
@Injectable()
export class MarketRegimeDetectorService {
  private readonly context = MarketRegimeDetectorService.name;
  private static readonly MIN_BARS = 50;

  constructor(private readonly logger: AppLoggerService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  detect(candles: ResearchCandle[], config: RegimeDetectionConfig = {}): RegimeDetectionResult {
    const n = candles.length;
    if (n < MarketRegimeDetectorService.MIN_BARS) {
      throw new ResearchInsufficientDataError(
        MarketRegimeDetectorService.MIN_BARS,
        n,
        'market regime detection',
      );
    }

    const cfg = this.resolveConfig(config);
    const closes = candles.map((c) => c.close);
    const timestamps = candles.map((c) => c.timestampMs);

    // Compute signals
    const shortMa = this.sma(closes, cfg.shortMaWindow);
    const longMa = this.sma(closes, cfg.longMaWindow);
    const logReturns = this.logReturns(closes);
    const rollingVol = this.annualisedVol(logReturns, cfg.volWindow, candles);
    const hurstSeries = this.hurstExponentSeries(logReturns, cfg.hurstWindow);

    // Classify each bar
    const regimes: RegimeBar[] = [];
    const warmup = cfg.longMaWindow;

    for (let i = warmup; i < n; i++) {
      const price = closes[i]!;
      const smaS = shortMa[i]!;
      const smaL = longMa[i]!;
      const vol = rollingVol[i] ?? 0;
      const hurst = hurstSeries[i] ?? 0.5;

      const trendDev = smaL > 0 ? Math.abs(price - smaL) / smaL : 0;

      const trend = this.classifyTrend(smaS, smaL, trendDev, cfg.trendDeviationThreshold, hurst);
      const volatility = this.classifyVolatility(vol, cfg.lowVolThreshold, cfg.highVolThreshold);
      const regime = this.combineRegime(trend, volatility);

      regimes.push({
        timestampMs: timestamps[i]!,
        regime,
        trend,
        volatility,
        realisedVolAnnualised: vol,
        trendDeviation: trendDev,
        hurstExponent: hurst,
      });
    }

    const stats = this.computeStats(regimes);

    this.logger.debug?.(
      `Regime detection: ${regimes.length} bars classified, ` +
        `${stats.transitionCount} transitions`,
      this.context,
    );

    return {
      regimes,
      regimeDistribution: stats.distribution,
      transitionCount: stats.transitionCount,
      avgRegimeDurationBars: stats.avgDuration,
      computedAt: new Date(),
    };
  }

  // ── Classification ────────────────────────────────────────────────────────

  private classifyTrend(
    shortMa: number,
    longMa: number,
    deviation: number,
    threshold: number,
    hurst: number,
  ): TrendState {
    // Hurst refinement: strong mean-reversion overrides trend signal
    if (hurst < 0.4 && deviation < threshold * 2) {
      return TrendState.SIDEWAYS;
    }

    if (shortMa > longMa && deviation > threshold) {
      return TrendState.BULL;
    }
    if (shortMa < longMa && deviation > threshold) {
      return TrendState.BEAR;
    }
    return TrendState.SIDEWAYS;
  }

  private classifyVolatility(vol: number, lowThresh: number, highThresh: number): VolatilityState {
    if (vol >= highThresh) return VolatilityState.HIGH;
    if (vol <= lowThresh) return VolatilityState.LOW;
    return VolatilityState.MEDIUM;
  }

  private combineRegime(trend: TrendState, volatility: VolatilityState): MarketRegime {
    const volatile = volatility === VolatilityState.HIGH;
    switch (trend) {
      case TrendState.BULL:
        return volatile ? MarketRegime.BULL_VOLATILE : MarketRegime.BULL_QUIET;
      case TrendState.BEAR:
        return volatile ? MarketRegime.BEAR_VOLATILE : MarketRegime.BEAR_QUIET;
      case TrendState.SIDEWAYS:
        return volatile ? MarketRegime.SIDEWAYS_VOLATILE : MarketRegime.SIDEWAYS_QUIET;
    }
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  private computeStats(regimes: RegimeBar[]): {
    distribution: Record<MarketRegime, number>;
    transitionCount: number;
    avgDuration: number;
  } {
    const counts: Record<MarketRegime, number> = {
      [MarketRegime.BULL_QUIET]: 0,
      [MarketRegime.BULL_VOLATILE]: 0,
      [MarketRegime.BEAR_QUIET]: 0,
      [MarketRegime.BEAR_VOLATILE]: 0,
      [MarketRegime.SIDEWAYS_QUIET]: 0,
      [MarketRegime.SIDEWAYS_VOLATILE]: 0,
    };
    let transitions = 0;
    let currentRegimeDuration = 1;
    let totalDuration = 0;
    let regimeCount = 1;

    for (let i = 0; i < regimes.length; i++) {
      counts[regimes[i]!.regime]++;
      if (i > 0 && regimes[i]!.regime !== regimes[i - 1]!.regime) {
        transitions++;
        totalDuration += currentRegimeDuration;
        regimeCount++;
        currentRegimeDuration = 1;
      } else {
        currentRegimeDuration++;
      }
    }
    totalDuration += currentRegimeDuration;

    const total = regimes.length;
    const distribution = Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, total > 0 ? v / total : 0]),
    ) as Record<MarketRegime, number>;

    return {
      distribution,
      transitionCount: transitions,
      avgDuration: regimeCount > 0 ? totalDuration / regimeCount : 0,
    };
  }

  // ── Signal Computations ───────────────────────────────────────────────────

  private sma(values: number[], window: number): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i]!;
      if (i >= window) sum -= values[i - window]!;
      if (i >= window - 1) result[i] = sum / window;
    }
    return result;
  }

  private logReturns(prices: number[]): number[] {
    const result = new Array<number>(prices.length).fill(NaN);
    for (let i = 1; i < prices.length; i++) {
      const p0 = prices[i - 1]!;
      const p1 = prices[i]!;
      result[i] = p0 > 0 && p1 > 0 ? Math.log(p1 / p0) : NaN;
    }
    return result;
  }

  private annualisedVol(logReturns: number[], window: number, candles: ResearchCandle[]): number[] {
    const result = new Array<number>(logReturns.length).fill(NaN);

    // Estimate periods per year from candle interval
    let periodsPerYear = 252;
    if (candles.length >= 2) {
      const avgIntervalMs =
        (candles[candles.length - 1]!.timestampMs - candles[0]!.timestampMs) / (candles.length - 1);
      periodsPerYear = Math.round((365 * 24 * 3600 * 1000) / avgIntervalMs);
    }

    for (let i = window; i < logReturns.length; i++) {
      const slice = logReturns.slice(i - window + 1, i + 1).filter(isFinite);
      if (slice.length < 2) continue;
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
      result[i] = Math.sqrt(variance * periodsPerYear);
    }
    return result;
  }

  /**
   * Rescaled-range (R/S) Hurst exponent estimate over a rolling window.
   * H ≈ log(R/S) / log(N)
   */
  private hurstExponentSeries(logReturns: number[], window: number): number[] {
    const result = new Array<number>(logReturns.length).fill(0.5);
    for (let i = window; i < logReturns.length; i++) {
      const slice = logReturns.slice(i - window + 1, i + 1).filter(isFinite);
      if (slice.length < 10) continue;
      result[i] = this.hurstRS(slice);
    }
    return result;
  }

  private hurstRS(series: number[]): number {
    const n = series.length;
    const mean = series.reduce((a, b) => a + b, 0) / n;

    // Cumulative deviation series
    const cumDev: number[] = [];
    let cum = 0;
    for (const v of series) {
      cum += v - mean;
      cumDev.push(cum);
    }

    const range = Math.max(...cumDev) - Math.min(...cumDev);
    const std = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    if (std <= 0 || range <= 0) return 0.5;

    return Math.log(range / std) / Math.log(n);
  }

  // ── Config Resolution ─────────────────────────────────────────────────────

  private resolveConfig(cfg: RegimeDetectionConfig): Required<RegimeDetectionConfig> {
    return {
      shortMaWindow: cfg.shortMaWindow ?? 20,
      longMaWindow: cfg.longMaWindow ?? 100,
      volWindow: cfg.volWindow ?? 20,
      highVolThreshold: cfg.highVolThreshold ?? 0.8,
      lowVolThreshold: cfg.lowVolThreshold ?? 0.3,
      trendDeviationThreshold: cfg.trendDeviationThreshold ?? 0.05,
      hurstWindow: cfg.hurstWindow ?? 40,
    };
  }
}
