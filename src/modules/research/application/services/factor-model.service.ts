import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  FactorDefinition,
  FactorExposure,
  FactorModelResult,
  FactorType,
} from '../../domain/models/factor-model.model';
import {
  ResearchCandle,
  ResearchFundingRate,
  ResearchOpenInterest,
} from '../../domain/models/research-dataset.model';
import { ResearchInsufficientDataError } from '../../domain/errors/research.errors';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FactorSeries {
  readonly type: FactorType;
  readonly returns: number[];
}

/**
 * FactorModelService decomposes asset returns into systematic factor exposures
 * using OLS (Ordinary Least Squares) regression.
 *
 * Supported factors:
 *   MARKET         — daily (bar-aligned) return of the series itself, used as
 *                    the market factor proxy (crypto has no separate index).
 *   MOMENTUM_SHORT — 1-period return lookback (1-20 bars).
 *   MOMENTUM_MED   — medium-term return (20-100 bars).
 *   MEAN_REVERSION — negative of short-term momentum.
 *   VOLATILITY     — realised vol (rolling std of returns), de-meaned.
 *   LIQUIDITY      — rolling volume z-score as liquidity proxy.
 *   FUNDING_CARRY  — funding rate de-meaned over the period.
 *   OPEN_INTEREST  — OI change rate.
 *
 * The multi-factor regression minimises:
 *   r[t] = α + Σ_k (β_k × f_k[t]) + ε[t]
 *
 * OLS is solved via the normal equations: β = (FᵀF)⁻¹ Fᵀ r
 * (2x2 through 9x9 matrix — safe to invert analytically for these sizes).
 *
 * Alpha (annualised) = mean(ε) × √(periods_per_year) × periods_per_year
 */
@Injectable()
export class FactorModelService {
  private readonly context = FactorModelService.name;
  private static readonly MIN_BARS = 60;

  constructor(private readonly logger: AppLoggerService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Compute factor exposures for the given candle series.
   *
   * @param experimentId     Identifier for logging/result attribution.
   * @param candles          OHLCV bars in ascending time order.
   * @param factors          Which factors to include.
   * @param fundingRates     Optional — required for FUNDING_CARRY factor.
   * @param openInterest     Optional — required for OPEN_INTEREST factor.
   */
  computeFactorModel(
    experimentId: string,
    candles: ResearchCandle[],
    factors: FactorDefinition[],
    fundingRates: ResearchFundingRate[] = [],
    openInterest: ResearchOpenInterest[] = [],
  ): FactorModelResult {
    if (candles.length < FactorModelService.MIN_BARS) {
      throw new ResearchInsufficientDataError(
        FactorModelService.MIN_BARS,
        candles.length,
        'factor model',
      );
    }

    // Asset log returns (dependent variable)
    const assetReturns = this.logReturns(candles.map((c) => c.close));

    // Build factor return series (aligned to assetReturns)
    const factorSeries = factors.map((def) =>
      this.buildFactorSeries(def, candles, assetReturns, fundingRates, openInterest),
    );

    // Align all series (drop leading NaN from short-lookback factors)
    const validStart = this.findValidStart(assetReturns, factorSeries);
    const y = assetReturns.slice(validStart);
    const X = factorSeries.map((fs) => fs.returns.slice(validStart));

    // OLS regression
    const { betas, residuals, rSquared } = this.olsRegression(y, X);

    // Per-factor exposure statistics
    const exposures: FactorExposure[] = factors.map((def, k) => {
      const betaK = betas[k + 1] ?? 0; // betas[0] = intercept (alpha)
      const stdErr = this.betaStdErr(y, X, betas, k + 1, residuals);
      return {
        factor: def.type,
        beta: betaK,
        betaStdErr: stdErr,
        tStat: stdErr > 0 ? betaK / stdErr : 0,
        rSquared: this.singleFactorR2(y, X[k]!),
      };
    });

    // Annualised alpha (intercept term scaled to daily → annual)
    const periodsPerYear = this.estimatePeriodsPerYear(candles);
    const rawAlpha = betas[0] ?? 0;
    const annualizedAlpha = rawAlpha * periodsPerYear;

    this.logger.debug?.(
      `Factor model for ${experimentId}: R²=${rSquared.toFixed(3)}, ` +
        `α_ann=${(annualizedAlpha * 100).toFixed(2)}%`,
      this.context,
    );

    return {
      experimentId,
      symbol: `${candles[0]!.close}`, // symbol is stored on dataset, not candle
      timeframe: 'unknown',
      periodStartMs: candles[validStart]!.timestampMs,
      periodEndMs: candles[candles.length - 1]!.timestampMs,
      exposures,
      totalRSquared: rSquared,
      annualizedAlpha,
      residuals,
      computedAt: new Date(),
    };
  }

  // ── Factor Construction ───────────────────────────────────────────────────

  private buildFactorSeries(
    def: FactorDefinition,
    candles: ResearchCandle[],
    assetReturns: number[],
    fundingRates: ResearchFundingRate[],
    openInterest: ResearchOpenInterest[],
  ): FactorSeries {
    const n = candles.length;
    const w = def.lookbackBars;
    let returns: number[];

    switch (def.type) {
      case FactorType.MARKET:
        // Market factor = asset returns themselves (single-asset universe)
        returns = [...assetReturns];
        break;

      case FactorType.MOMENTUM_SHORT:
        returns = this.cumulativeReturn(
          candles.map((c) => c.close),
          w,
        );
        break;

      case FactorType.MOMENTUM_MEDIUM:
        returns = this.cumulativeReturn(
          candles.map((c) => c.close),
          w,
        );
        break;

      case FactorType.MEAN_REVERSION:
        // Negative of short-term momentum
        returns = this.cumulativeReturn(
          candles.map((c) => c.close),
          w,
        ).map((v) => (isFinite(v) ? -v : NaN));
        break;

      case FactorType.VOLATILITY: {
        // Realised volatility (rolling std of log returns), de-meaned
        const rollingVol = this.rollingStd(assetReturns, w);
        const mean = this.mean(rollingVol.filter(isFinite));
        returns = rollingVol.map((v) => (isFinite(v) ? v - mean : NaN));
        break;
      }

      case FactorType.LIQUIDITY: {
        // Volume z-score
        const volumes = candles.map((c) => c.volume);
        returns = this.rollingZscore(volumes, w);
        break;
      }

      case FactorType.FUNDING_CARRY: {
        if (fundingRates.length === 0) {
          returns = new Array<number>(n).fill(0);
        } else {
          returns = this.alignFundingRates(candles, fundingRates);
          const mean = this.mean(returns.filter(isFinite));
          returns = returns.map((v) => (isFinite(v) ? v - mean : NaN));
        }
        break;
      }

      case FactorType.OPEN_INTEREST: {
        if (openInterest.length === 0) {
          returns = new Array<number>(n).fill(0);
        } else {
          const oiSeries = this.alignOpenInterest(candles, openInterest);
          returns = this.logReturns(oiSeries);
        }
        break;
      }

      default:
        returns = new Array<number>(n).fill(0);
    }

    return { type: def.type, returns };
  }

  // ── OLS Regression ────────────────────────────────────────────────────────

  /**
   * Solves y = Xβ + ε via normal equations: β = (XᵀX)⁻¹ Xᵀy
   * X is augmented with a constant column (intercept).
   * Returns betas[0] = intercept, betas[1..k] = factor betas.
   */
  private olsRegression(
    y: number[],
    X: number[][],
  ): { betas: number[]; residuals: number[]; rSquared: number } {
    const n = y.length;
    const k = X.length;
    const p = k + 1; // including intercept

    // Build design matrix columns: [1, x1, x2, ...]
    const cols: number[][] = [new Array<number>(n).fill(1), ...X];

    // XᵀX (p × p) and Xᵀy (p × 1)
    const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const Xty = new Array<number>(p).fill(0);

    for (let i = 0; i < n; i++) {
      for (let a = 0; a < p; a++) {
        Xty[a] += cols[a]![i]! * y[i]!;
        for (let b = 0; b < p; b++) {
          XtX[a]![b]! += cols[a]![i]! * cols[b]![i]!;
        }
      }
    }

    // Solve via Gaussian elimination
    const betas = this.gaussianElimination(XtX, Xty);

    // Residuals and R²
    const yMean = this.mean(y);
    let ssTot = 0;
    let ssRes = 0;
    const residuals = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const yHat = betas.reduce((acc, b, j) => acc + b * (cols[j]![i] ?? 0), 0);
      residuals[i] = y[i]! - yHat;
      ssTot += (y[i]! - yMean) ** 2;
      ssRes += residuals[i]! ** 2;
    }
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return { betas, residuals, rSquared };
  }

  /** Gaussian elimination with partial pivoting to solve Ax = b. */
  private gaussianElimination(A: number[][], b: number[]): number[] {
    const n = b.length;
    // Augmented matrix
    const M = A.map((row, i) => [...row, b[i]!]);

    for (let col = 0; col < n; col++) {
      // Partial pivot
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row]![col]!) > Math.abs(M[maxRow]![col]!)) {
          maxRow = row;
        }
      }
      [M[col], M[maxRow]] = [M[maxRow]!, M[col]!];

      const pivot = M[col]![col]!;
      if (Math.abs(pivot) < 1e-12) continue; // near-singular, skip

      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = M[row]![col]! / pivot;
        for (let c = col; c <= n; c++) {
          M[row]![c]! -= factor * M[col]![c]!;
        }
      }
    }

    return M.map((row, i) => {
      const diag = row[i]!;
      return Math.abs(diag) > 1e-12 ? row[n]! / diag : 0;
    });
  }

  /** Standard error of beta_k via σ²(XᵀX)⁻¹_kk, simplified as σ/sqrt(Σx_k²). */
  private betaStdErr(
    y: number[],
    X: number[][],
    betas: number[],
    k: number,
    residuals: number[],
  ): number {
    const n = y.length;
    const p = betas.length;
    const sigma2 = residuals.reduce((s, r) => s + r * r, 0) / Math.max(n - p, 1);
    const xk = X[k - 1]!;
    const xkSS = xk.reduce((s, v) => s + v * v, 0);
    return xkSS > 0 ? Math.sqrt(sigma2 / xkSS) : 0;
  }

  private singleFactorR2(y: number[], x: number[]): number {
    const { rSquared } = this.olsRegression(y, [x]);
    return rSquared;
  }

  // ── Helper Computations ───────────────────────────────────────────────────

  private logReturns(prices: number[]): number[] {
    const result = new Array<number>(prices.length).fill(NaN);
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1]!;
      const curr = prices[i]!;
      result[i] = prev > 0 && curr > 0 ? Math.log(curr / prev) : NaN;
    }
    return result;
  }

  private cumulativeReturn(prices: number[], lookback: number): number[] {
    const result = new Array<number>(prices.length).fill(NaN);
    for (let i = lookback; i < prices.length; i++) {
      const base = prices[i - lookback]!;
      result[i] = base > 0 ? Math.log(prices[i]! / base) : NaN;
    }
    return result;
  }

  private rollingStd(values: number[], window: number): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = window - 1; i < values.length; i++) {
      const slice = values.slice(i - window + 1, i + 1).filter(isFinite);
      if (slice.length < 2) continue;
      const m = this.mean(slice);
      result[i] = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / (slice.length - 1));
    }
    return result;
  }

  private rollingZscore(values: number[], window: number): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    for (let i = window - 1; i < values.length; i++) {
      const slice = values.slice(i - window + 1, i + 1);
      const m = this.mean(slice);
      const std = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / window);
      result[i] = std > 0 ? (values[i]! - m) / std : 0;
    }
    return result;
  }

  private mean(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  private findValidStart(assetReturns: number[], factors: FactorSeries[]): number {
    let start = 0;
    for (let i = 0; i < assetReturns.length; i++) {
      const allValid =
        isFinite(assetReturns[i]!) && factors.every((fs) => isFinite(fs.returns[i] ?? NaN));
      if (allValid) {
        start = i;
        break;
      }
    }
    return start;
  }

  private alignFundingRates(
    candles: ResearchCandle[],
    fundingRates: ResearchFundingRate[],
  ): number[] {
    const result = new Array<number>(candles.length).fill(NaN);
    let fi = 0;
    for (let i = 0; i < candles.length; i++) {
      while (
        fi < fundingRates.length - 1 &&
        fundingRates[fi + 1]!.timestampMs <= candles[i]!.timestampMs
      ) {
        fi++;
      }
      if (fi < fundingRates.length) {
        result[i] = fundingRates[fi]!.rate;
      }
    }
    return result;
  }

  private alignOpenInterest(
    candles: ResearchCandle[],
    openInterest: ResearchOpenInterest[],
  ): number[] {
    const result = new Array<number>(candles.length).fill(NaN);
    let oi = 0;
    for (let i = 0; i < candles.length; i++) {
      while (
        oi < openInterest.length - 1 &&
        openInterest[oi + 1]!.timestampMs <= candles[i]!.timestampMs
      ) {
        oi++;
      }
      if (oi < openInterest.length) {
        result[i] = openInterest[oi]!.openInterest;
      }
    }
    return result;
  }

  private estimatePeriodsPerYear(candles: ResearchCandle[]): number {
    if (candles.length < 2) return 252;
    const avgIntervalMs =
      (candles[candles.length - 1]!.timestampMs - candles[0]!.timestampMs) / (candles.length - 1);
    const msPerYear = 365 * 24 * 3600 * 1000;
    return Math.round(msPerYear / avgIntervalMs);
  }
}
