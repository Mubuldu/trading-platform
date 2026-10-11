import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';

// ──────────────────────────────────────────────────────────────────────────────
// Shared types (imported by TrendFollowingV1Strategy)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 12-feature vector computed from the last N candles before a potential entry.
 *
 * All values are pre-computed by TrendFollowingV1Strategy from the indicators
 * already in the StrategyContext — no extra indicator lookups required.
 * Missing/unavailable features should be set to 0.0; the model handles neutral
 * input gracefully.
 *
 * Field names are camelCase and must match the Pydantic `Features` model in
 * ml-service/main.py exactly — they are JSON-serialised over HTTP.
 */
export interface SignalFeatures {
  /** 1-candle return: close₀ / close₋₁ − 1. */
  ret1h: number;
  /** 4-candle return. */
  ret4h: number;
  /** 24-candle return. */
  ret24h: number;
  /** 72-candle return (≈ 3 days on a 1h timeframe). */
  ret72h: number;
  /** ATR(14) / close — normalised volatility. */
  atrNorm: number;
  /** Volume / volumeMA(20) — current volume relative to its 20-bar moving average. */
  volRatio: number;
  /** (emaFast − emaSlow) / emaSlow — trend strength and direction (positive = bullish). */
  emaSpread: number;
  /** ADX(14) — trend regime strength (0–100). */
  adx: number;
  /** (close − donchianLow) / (donchianHigh − donchianLow) — position within the Donchian channel [0, 1]. */
  donPos: number;
  /** sin(2π × hour / 24) — intraday seasonality. */
  hourSin: number;
  /** cos(2π × hour / 24) — intraday seasonality. */
  hourCos: number;
  /** sin(2π × dayOfWeek / 7) — day-of-week seasonality. */
  dowSin: number;
  /**
   * RSI(14) [0–100] — momentum quality at entry.
   * Computed from the 73-bar closeHistory stored in strategy state.
   * A strong breakout entry typically shows RSI 55–75 (momentum confirmation);
   * RSI > 80 can flag exhaustion; RSI < 45 means the breakout lacks follow-through.
   */
  rsi14: number;
  /**
   * (PDI − NDI) / (PDI + NDI) ∈ [−1, +1] — directional conviction behind ADX.
   * +1 = pure bullish trend (PDI dominates), −1 = pure bearish.
   * Captures the directionality that the ADX magnitude value alone misses.
   */
  pdiNdiRatio: number;
}

/**
 * Response from POST /predict on the Python ML sidecar.
 */
export interface MlPrediction {
  /** Probability that this trade will be profitable (0–1). */
  readonly confidence: number;
  /** 'enter' when confidence ≥ 0.55, 'skip' otherwise. */
  readonly signal: 'enter' | 'skip';
  /** Opaque version string that changes whenever the model artifact is reloaded. */
  readonly modelVersion: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pass-through prediction used when:
 *   - ML_SERVICE_URL is not set (backtesting / local dev without sidecar)
 *   - The sidecar times out or is unreachable
 *   - The model is not yet trained (sidecar returns "unloaded")
 *
 * confidence = 0.5 keeps signals exactly as they were before ML was added.
 */
const FALLBACK_PREDICTION: MlPrediction = {
  confidence: 0.5,
  signal: 'enter',
  modelVersion: 'fallback',
};

/** Maximum wait for the Python sidecar.  Never block trading. */
const SCORE_TIMEOUT_MS = 500;

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

/**
 * MlSignalService — HTTP client wrapper around the Python ML sidecar.
 *
 * ## Graceful degradation contract
 *
 * The ML layer is an optional quality filter.  The strategy works correctly
 * without it.  This service NEVER throws and NEVER blocks signal generation for
 * more than SCORE_TIMEOUT_MS (500 ms).  On any failure (timeout, network error,
 * model not loaded) it returns FALLBACK_PREDICTION, which lets every signal
 * through — identical behaviour to running without ML.
 *
 * ## When ML is disabled
 *
 * If ML_SERVICE_URL is not set or is empty, score() returns FALLBACK_PREDICTION
 * immediately without touching the network.  This is the correct behaviour for:
 *   - Parameter optimisation runs (no sidecar running)
 *   - Local development without Docker
 *   - Any environment where the sidecar is not deployed
 *
 * ## Threading
 *
 * Uses Node.js native fetch (Node 20+) with AbortSignal.timeout().
 * The sidecar uses async Uvicorn workers so concurrent requests are safe.
 */
@Injectable()
export class MlSignalService {
  private readonly context = MlSignalService.name;
  private readonly baseUrl: string;

  constructor(private readonly logger: AppLoggerService) {
    this.baseUrl = (process.env['ML_SERVICE_URL'] ?? '').trim();
    if (this.baseUrl) {
      this.logger.log(`ML signal service pointing at ${this.baseUrl}`, this.context);
    } else {
      this.logger.log(
        'ML_SERVICE_URL not set — ML scoring disabled (all signals pass through)',
        this.context,
      );
    }
  }

  /**
   * Score a candidate entry signal.
   *
   * @returns MlPrediction — always resolves, never rejects.
   *   Falls back gracefully on network error, timeout, or missing model.
   */
  async score(features: SignalFeatures): Promise<MlPrediction> {
    // Fast path: ML not configured — skip network call entirely
    if (!this.baseUrl) {
      return FALLBACK_PREDICTION;
    }

    try {
      const response = await fetch(`${this.baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(features),
        signal: AbortSignal.timeout(SCORE_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `ML sidecar returned ${response.status} — falling back to pass-through`,
          this.context,
        );
        return FALLBACK_PREDICTION;
      }

      const data = (await response.json()) as MlPrediction;

      // If the model is not yet trained the sidecar returns modelVersion='unloaded'.
      // Treat it as a pass-through so backfilling trades before retraining still works.
      if (data.modelVersion === 'unloaded') {
        return FALLBACK_PREDICTION;
      }

      return data;
    } catch {
      // AbortError (timeout) or network failure — non-fatal
      return FALLBACK_PREDICTION;
    }
  }

  /**
   * Check whether the ML sidecar is reachable and has a loaded model.
   * Used for health endpoints; not called in the hot path.
   */
  async healthCheck(): Promise<{ reachable: boolean; modelLoaded: boolean; modelVersion: string }> {
    if (!this.baseUrl) {
      return { reachable: false, modelLoaded: false, modelVersion: 'disabled' };
    }
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return { reachable: false, modelLoaded: false, modelVersion: 'error' };
      const body = (await response.json()) as {
        modelLoaded: boolean;
        modelVersion: string;
      };
      return { reachable: true, modelLoaded: body.modelLoaded, modelVersion: body.modelVersion };
    } catch {
      return { reachable: false, modelLoaded: false, modelVersion: 'unreachable' };
    }
  }
}
