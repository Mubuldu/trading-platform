/**
 * Pure statistical utility functions shared across the parameter-stability module.
 * No external dependencies — all algorithms are self-contained.
 */

// ── Basic descriptive statistics ─────────────────────────────────────────────

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Standard deviation.
 * @param ddof Delta degrees of freedom (1 = sample std, 0 = population std).
 */
export function stdDev(values: number[], ddof = 1): number {
  const n = values.length;
  if (n <= ddof) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - ddof);
  return Math.sqrt(variance);
}

/** Median (does not mutate the input). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Bias-corrected sample skewness (Fisher's g₁).
 * Returns 0 for n < 3 or zero variance.
 */
export function skewness(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const m = mean(values);
  const s = stdDev(values, 0); // population std for the standardisation step
  if (s === 0) return 0;
  const g1 = values.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0) / n;
  // bias correction: multiply by sqrt(n*(n-1)) / (n-2)
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
}

/**
 * Bias-corrected sample excess kurtosis (Fisher's g₂).
 * Returns 0 for n < 4 or zero variance.
 */
export function excessKurtosis(values: number[]): number {
  const n = values.length;
  if (n < 4) return 0;
  const m = mean(values);
  const s = stdDev(values, 0);
  if (s === 0) return 0;
  const g2 = values.reduce((sum, v) => sum + ((v - m) / s) ** 4, 0) / n;
  // Fisher's formula for bias-corrected excess kurtosis
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 - 3 * (n - 1));
}

// ── Normal distribution ───────────────────────────────────────────────────────

/**
 * Standard normal CDF  Φ(x).
 * Uses Abramowitz & Stegun approximation 7.1.26 — max absolute error 1.5 × 10⁻⁷.
 */
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  // Polynomial p(t)·exp(−ax²) ≈ erfc(ax)
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-ax * ax)));
}

/**
 * Inverse standard normal CDF  Φ⁻¹(p).
 * Peter Acklam's rational approximation — max absolute error 3 × 10⁻⁹.
 */
export function normalInvCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }

  // p > pHigh
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}
