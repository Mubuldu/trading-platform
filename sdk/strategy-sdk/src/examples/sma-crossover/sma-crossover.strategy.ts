/**
 * SMA Crossover Strategy — Reference implementation for the Strategy SDK.
 *
 * This file demonstrates the complete lifecycle of an SDK strategy, from manifest
 * declaration through warmup and signal generation. Read it alongside
 * sdk/strategy-sdk/docs/plugin-sdk-guide.md.
 *
 * ## Strategy logic
 *
 * Classic dual-SMA crossover (no prediction, pure rule-based):
 *   - BUY  when fast SMA crosses above slow SMA (bullish cross)
 *   - SELL when fast SMA crosses below slow SMA (bearish cross)
 *   - EXIT when opposite cross occurs while in position
 *
 * A volume filter confirms entries: the current candle's volume must exceed
 * the 20-period volume MA. This reduces false signals in low-liquidity periods.
 *
 * ## Parameters (via StrategyPluginConfig.parameters)
 *
 *   fastPeriod   — fast SMA period (default: 10)
 *   slowPeriod   — slow SMA period (default: 30; must be > fastPeriod)
 *   volumePeriod — volume MA period for the volume filter (default: 20)
 *   timeframe    — candle interval (default: '1h')
 *
 * ## Permissions required
 *
 *   READ_INDICATORS    — reads SMA and volume MA values from ctx.indicators
 *   GENERATE_SIGNALS   — emits BUY / SELL / EXIT signals
 *
 * ## Important notes for strategy authors
 *
 *   1. Never import from platform internals (@modules/*, @infrastructure/*)
 *   2. Never call process.env — environment variables are blocked
 *   3. Never use fs, net, http — file system and network are blocked
 *   4. Hold context only for the duration of the hook — do not store ctx across calls
 *   5. Return null when uncertain — never guess
 */

import {
  SdkStrategy,
  PluginManifest,
  StrategyPermission,
  SdkStrategyContext,
  SdkSignal,
  SdkSignalDirection,
  SdkIndicatorType,
  SdkInitContext,
  SdkWarmupContext,
  SdkCandle,
  SdkConfigValidationError,
  SdkResult,
  sdkOk,
  sdkErr,
  indicatorKey,
} from '../../index';

// ── Parameters ────────────────────────────────────────────────────────────────

export interface SmaCrossoverParams {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly volumePeriod: number;
  readonly timeframe: string;
}

const DEFAULT_PARAMS: SmaCrossoverParams = {
  fastPeriod:   10,
  slowPeriod:   30,
  volumePeriod: 20,
  timeframe:    '1h',
};

// ── Manifest ──────────────────────────────────────────────────────────────────

export const SMA_CROSSOVER_MANIFEST: PluginManifest = {
  id:                 'sma-crossover-v1',
  name:               'SMA Crossover',
  version:            '1.0.0',
  author: {
    name:  'Trading Platform Contributors',
    email: 'sdk@trading-platform.example.com',
    url:   'https://trading-platform.example.com',
  },
  license:            'MIT',
  description:
    'Dual simple-moving-average crossover with volume confirmation. ' +
    'Generates BUY on bullish cross, SELL on bearish cross, EXIT on reverse cross. ' +
    'No prediction — pure rule-based trend following.',
  requiredSdkVersion: '^1.0.0',
  permissions: [
    StrategyPermission.READ_INDICATORS,
    StrategyPermission.GENERATE_SIGNALS,
  ],
  riskLimits: {
    maxPositionSizePercent: 2,
    maxDrawdownPercent:     10,
    maxOpenOrders:          1,
    maxRuntimeMs:           500,
    maxEventsPerSecond:     100,
  },
  keywords:   ['sma', 'crossover', 'trend', 'example', 'moving-average'],
  homepage:   'https://trading-platform.example.com/plugins/sma-crossover-v1',
};

// ── Internal state ─────────────────────────────────────────────────────────────

type CrossoverPosition = 'FLAT' | 'LONG' | 'SHORT';

interface SmaCrossoverState {
  position:    CrossoverPosition;
  prevFastSma: number | null;
  prevSlowSma: number | null;
  lastClose:   number;
  lastVolume:  number;
}

function freshState(): SmaCrossoverState {
  return {
    position:    'FLAT',
    prevFastSma: null,
    prevSlowSma: null,
    lastClose:   0,
    lastVolume:  0,
  };
}

// ── Strategy ──────────────────────────────────────────────────────────────────

/**
 * SmaCrossoverStrategy is the canonical example SDK strategy.
 *
 * To install this strategy on the platform, pass this class to the PluginManager:
 *
 *   await pluginManager.install(new SmaCrossoverStrategy(), config);
 */
export class SmaCrossoverStrategy extends SdkStrategy {
  readonly manifest: PluginManifest = SMA_CROSSOVER_MANIFEST;

  private params: SmaCrossoverParams = DEFAULT_PARAMS;
  private st: SmaCrossoverState = freshState();

  // ── Configuration validation ───────────────────────────────────────────────

  override validateConfig(config: unknown): SdkResult<void, SdkConfigValidationError> {
    const id = this.strategyId || 'sma-crossover-v1';
    const p = config as Partial<SmaCrossoverParams>;

    if (p.fastPeriod !== undefined && (typeof p.fastPeriod !== 'number' || p.fastPeriod <= 0)) {
      return sdkErr(new SdkConfigValidationError(id, 'fastPeriod must be a positive integer.'));
    }
    if (p.slowPeriod !== undefined && (typeof p.slowPeriod !== 'number' || p.slowPeriod <= 0)) {
      return sdkErr(new SdkConfigValidationError(id, 'slowPeriod must be a positive integer.'));
    }
    const fast = p.fastPeriod ?? DEFAULT_PARAMS.fastPeriod;
    const slow = p.slowPeriod ?? DEFAULT_PARAMS.slowPeriod;
    if (fast >= slow) {
      return sdkErr(new SdkConfigValidationError(id, 'fastPeriod must be less than slowPeriod.'));
    }
    if (p.volumePeriod !== undefined && (typeof p.volumePeriod !== 'number' || p.volumePeriod <= 0)) {
      return sdkErr(new SdkConfigValidationError(id, 'volumePeriod must be a positive integer.'));
    }

    return sdkOk(undefined);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  protected override async onInitialize(ctx: SdkInitContext): Promise<void> {
    this.log(`[SmaCrossover] Initializing for ${ctx.symbol} on ${ctx.exchange}`);
    this.st = freshState();
    // Apply parameters from the platform configuration, falling back to defaults
    // for any parameter not provided. Parameters are validated by validateConfig()
    // before this hook is called.
    const p = ctx.parameters as Partial<SmaCrossoverParams>;
    this.params = {
      fastPeriod:   typeof p.fastPeriod   === 'number' ? p.fastPeriod   : DEFAULT_PARAMS.fastPeriod,
      slowPeriod:   typeof p.slowPeriod   === 'number' ? p.slowPeriod   : DEFAULT_PARAMS.slowPeriod,
      volumePeriod: typeof p.volumePeriod === 'number' ? p.volumePeriod : DEFAULT_PARAMS.volumePeriod,
      timeframe:    typeof p.timeframe    === 'string' ? p.timeframe    : DEFAULT_PARAMS.timeframe,
    };
    this.log(`[SmaCrossover] Parameters: fast=${this.params.fastPeriod}, slow=${this.params.slowPeriod}, volume=${this.params.volumePeriod}, tf=${this.params.timeframe}`);
  }

  protected override async onWarmup(ctx: SdkWarmupContext): Promise<void> {
    this.log(`[SmaCrossover] Warming up — loading historical candles for ${ctx.symbol}`);
    this.setWarmupProgress(0.0);

    // Load enough history to compute slowPeriod candles
    const candles = await ctx.historical.getCandles({
      symbol:    ctx.symbol,
      timeframe: this.params.timeframe as Parameters<typeof ctx.historical.getCandles>[0]['timeframe'],
      limit:     this.params.slowPeriod * 3, // 3× for a reliable SMA baseline
    });

    if (candles.length < this.params.slowPeriod) {
      this.log(
        `[SmaCrossover] Insufficient history: need ${this.params.slowPeriod} candles, ` +
        `got ${candles.length}. Strategy will wait for more data.`,
      );
      this.setWarmupProgress(candles.length / this.params.slowPeriod);
      return;
    }

    // Seed state from the last candle so generateSignal has a valid baseline
    const last = candles[candles.length - 1];
    if (last) {
      this.st.lastClose  = last.close;
      this.st.lastVolume = last.volume;
    }

    this.setWarmupProgress(1.0);
    this.log(`[SmaCrossover] Warmup complete — ${candles.length} candles loaded.`);
  }

  protected override async onShutdown(): Promise<void> {
    this.log(`[SmaCrossover] Shutting down — resetting internal state.`);
    this.st = freshState();
  }

  // ── Market hooks ───────────────────────────────────────────────────────────

  protected override async onCandle(candle: SdkCandle): Promise<void> {
    // Only track candles that match the configured timeframe
    if (candle.timeframe !== this.params.timeframe) return;
    // Only update state on closed candles to avoid acting on partial bars
    if (!candle.isClosed) return;

    this.st.lastClose  = candle.close;
    this.st.lastVolume = candle.volume;
  }

  // ── Signal generation ──────────────────────────────────────────────────────

  /**
   * Emits a signal when the fast SMA crosses the slow SMA on a closed candle,
   * provided the current candle's volume exceeds its moving average.
   *
   * Returns null when:
   *   - No closed candle has been received yet (no OHLCV baseline)
   *   - SMA indicators are not yet available (insufficient history)
   *   - Volume MA is not available
   *   - No crossover detected this cycle
   */
  protected override async generateSignal(ctx: SdkStrategyContext): Promise<SdkSignal | null> {
    if (this.st.lastClose === 0) {
      this.skip(); // No candle received yet
      return null;
    }

    const tf  = this.params.timeframe;
    const sym = ctx.symbol;

    // Read indicator values from the platform's indicator cache
    const fastSmaVal = ctx.indicators.get(
      indicatorKey(SdkIndicatorType.SMA, sym, tf as Parameters<typeof indicatorKey>[2], this.params.fastPeriod),
    );
    const slowSmaVal = ctx.indicators.get(
      indicatorKey(SdkIndicatorType.SMA, sym, tf as Parameters<typeof indicatorKey>[2], this.params.slowPeriod),
    );
    const volumeMaVal = ctx.indicators.get(
      indicatorKey(SdkIndicatorType.VOLUME_MA, sym, tf as Parameters<typeof indicatorKey>[2], this.params.volumePeriod),
    );

    // All three must be available before we can make a decision
    if (
      !fastSmaVal || fastSmaVal.type !== SdkIndicatorType.SMA ||
      !slowSmaVal || slowSmaVal.type !== SdkIndicatorType.SMA ||
      !volumeMaVal || volumeMaVal.type !== SdkIndicatorType.VOLUME_MA
    ) {
      this.skip(); // Indicator warmup not yet complete
      return null;
    }

    const fastSma  = fastSmaVal.value;
    const slowSma  = slowSmaVal.value;
    const volumeMa = volumeMaVal.value;

    // Volume filter: require above-average volume for entries
    const volumeConfirmed = this.st.lastVolume > volumeMa;

    // Detect crossover against previous values
    const prevFast = this.st.prevFastSma;
    const prevSlow = this.st.prevSlowSma;

    // Advance the crossover baseline BEFORE early returns
    this.st.prevFastSma = fastSma;
    this.st.prevSlowSma = slowSma;

    // Need one previous cycle to detect a cross
    if (prevFast === null || prevSlow === null) {
      return null; // First cycle — no previous baseline yet
    }

    let signal: SdkSignal | null = null;

    // ── Exit conditions (checked before entry) ────────────────────────────────
    if (this.st.position === 'LONG' && fastSma < slowSma) {
      // Bearish cross while long — exit
      signal = this.buildSignal(ctx, SdkSignalDirection.EXIT,
        `Bearish SMA cross: SMA(${this.params.fastPeriod})=${fastSma.toFixed(2)} < SMA(${this.params.slowPeriod})=${slowSma.toFixed(2)}`,
        1.0,
        { fastSma, slowSma },
      );
      this.st.position = 'FLAT';

    } else if (this.st.position === 'SHORT' && fastSma > slowSma) {
      // Bullish cross while short — exit
      signal = this.buildSignal(ctx, SdkSignalDirection.EXIT,
        `Bullish SMA cross: SMA(${this.params.fastPeriod})=${fastSma.toFixed(2)} > SMA(${this.params.slowPeriod})=${slowSma.toFixed(2)}`,
        1.0,
        { fastSma, slowSma },
      );
      this.st.position = 'FLAT';
    }

    // ── Entry conditions (only when flat) ────────────────────────────────────
    else if (this.st.position === 'FLAT') {
      const wasBearish = prevFast <= prevSlow;
      const isBullish  = fastSma  >  slowSma;

      if (wasBearish && isBullish && volumeConfirmed) {
        // Bullish crossover with volume — buy
        const confidence = this.crossoverConfidence(fastSma, slowSma, this.st.lastVolume, volumeMa);
        signal = this.buildSignal(ctx, SdkSignalDirection.BUY,
          `Bullish SMA cross: SMA(${this.params.fastPeriod})=${fastSma.toFixed(2)} > SMA(${this.params.slowPeriod})=${slowSma.toFixed(2)}, volume confirmed`,
          confidence,
          { fastSma, slowSma, volume: this.st.lastVolume, volumeMa },
        );
        this.st.position = 'LONG';

      } else if (!wasBearish && fastSma <= slowSma && volumeConfirmed) {
        // Bearish crossover with volume — sell
        const confidence = this.crossoverConfidence(slowSma, fastSma, this.st.lastVolume, volumeMa);
        signal = this.buildSignal(ctx, SdkSignalDirection.SELL,
          `Bearish SMA cross: SMA(${this.params.fastPeriod})=${fastSma.toFixed(2)} < SMA(${this.params.slowPeriod})=${slowSma.toFixed(2)}, volume confirmed`,
          confidence,
          { fastSma, slowSma, volume: this.st.lastVolume, volumeMa },
        );
        this.st.position = 'SHORT';
      }
    }

    return signal;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Confidence is proportional to:
   *   60% — normalized separation between the two SMAs (larger gap = stronger trend)
   *   40% — volume ratio above the MA (volume spike = stronger confirmation)
   *
   * Both components are clamped to [0, 1] before weighting.
   */
  private crossoverConfidence(
    larger: number,
    smaller: number,
    currentVolume: number,
    volumeMa: number,
  ): number {
    const smaGap       = smaller > 0 ? (larger - smaller) / smaller : 0;
    const smaScore     = Math.min(smaGap * 20, 1); // normalise: 5% gap = score 1.0
    const volumeRatio  = volumeMa > 0 ? currentVolume / volumeMa : 1;
    const volumeScore  = Math.min((volumeRatio - 1) * 2, 1); // 1.5× volume = score 1.0
    return Math.max(0, Math.min(1, smaScore * 0.6 + volumeScore * 0.4));
  }

  private buildSignal(
    ctx: SdkStrategyContext,
    direction: SdkSignalDirection,
    reason: string,
    confidence: number,
    metadata: Record<string, unknown>,
  ): SdkSignal {
    return {
      symbol:     ctx.symbol,
      direction,
      confidence,
      reason,
      metadata: {
        ...metadata,
        fastPeriod:   this.params.fastPeriod,
        slowPeriod:   this.params.slowPeriod,
        timeframe:    this.params.timeframe,
        lastClose:    this.st.lastClose,
      },
    };
  }
}
