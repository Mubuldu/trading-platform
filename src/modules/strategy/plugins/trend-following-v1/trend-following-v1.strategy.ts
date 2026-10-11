import { Result, ok, err } from '@common/result';
import { randomUUID } from 'crypto';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { IndicatorType } from '@modules/indicator/domain/enums/indicator-type.enum';
import {
  AdxValue,
  AtrValue,
  DonchianValue,
  EmaValue,
  VolumeMaValue,
} from '@modules/indicator/domain/models/indicator-value.model';
import { MarketTick } from '@modules/exchange/models/market.models';
import { MlSignalService, SignalFeatures } from '@modules/ml/application/services/ml-signal.service';
import { BaseStrategy } from '../../framework/base-strategy';
import { Signal } from '../../interfaces/signal.interface';
import { StrategyContext, StrategyPluginConfig } from '../../interfaces/strategy.interface';
import { SignalDirection } from '../../domain/enums/signal-direction.enum';
import { StrategyConfigValidationError } from '../../domain/errors/strategy.errors';

export const TREND_FOLLOWING_V1_TYPE = 'trend-following-v1';

/**
 * All tunable parameters for TrendFollowingV1.
 *
 * Expressed as plain numbers so they survive JSON serialisation in StrategyPluginConfig.parameters.
 */
export interface TrendFollowingV1Params {
  /** Fast EMA period used for trend direction (default: 50). */
  emaPeriodFast: number;
  /** Slow EMA period used for trend direction (default: 200). Must be > emaPeriodFast. */
  emaPeriodSlow: number;
  /** ATR period for trailing stop and volatility filter (default: 14). */
  atrPeriod: number;
  /** ATR multiplier for the trailing stop distance (default: 2.0). */
  atrMultiplier: number;
  /** Minimum ATR required to place a trade. 0 = disabled (default: 0). */
  atrMinThreshold: number;
  /** ADX period for market-regime filter (default: 14). */
  adxPeriod: number;
  /** Minimum ADX value; below this the market is considered ranging (default: 25). */
  adxThreshold: number;
  /** Donchian channel look-back window for breakout detection (default: 20). */
  donchianWindow: number;
  /** Volume moving-average period for the volume filter (default: 20). */
  volumeMaPeriod: number;
  /** Candles to skip after a stop-loss exit before allowing re-entry (default: 10). */
  cooldownCandles: number;
  /** Emergency exit: close position after this many candles regardless of P&L (default: 100). */
  maxHoldingCandles: number;
  /** Candle timeframe this strategy watches, must match Timeframe enum values (default: '1h'). */
  timeframe: string;
  /**
   * Tolerance applied to the Donchian breakout check, expressed as a percentage (0–100).
   *
   * When > 0, the close only needs to reach prevDonchianUpper × (1 − tol/100) rather than
   * strictly exceed it. This catches "sitting at the band" situations where price is within
   * a few basis points of the breakout level but the strict `>` keeps blocking entry.
   *
   * Default: 0.15 (15 bps). Set to 0 to require a strict breakout with no tolerance.
   */
  donchianBreakoutTolerancePct: number;
}

type PositionState = 'FLAT' | 'LONG' | 'SHORT';

export interface StrategyThought {
  strategyId: string;
  /** Which symbol this thought is for (e.g. 'BTC/USDT'). */
  symbol: string;
  /** Most recent mid-price from the live tick feed. null = no tick received yet. */
  livePrice: number | null;
  /** Epoch ms of the last tick that updated livePrice. null = no tick received yet. */
  livePriceAt: number | null;
  /** Epoch ms of the last closed candle that updated indicators. null = warmup not yet done. */
  indicatorsUpdatedAt: number | null;
  positionState: PositionState;
  /** High-level mode label. */
  mode: 'NO_DATA' | 'COOLDOWN' | 'SCANNING' | 'IN_POSITION';
  /** One human-readable sentence explaining what the strategy is doing right now. */
  summary: string;
  /** Live indicator values from the last generateSignal call. null = not yet populated. */
  indicators: {
    emaFast: number;
    emaSlow: number;
    emaTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    atr: number;
    adx: number;
    adxTrending: boolean;
    pdi: number;
    ndi: number;
    donchianUpper: number;
    donchianLower: number;
    volumeRatio: number;
    volumeConfirmed: boolean;
  } | null;
  /** Entry condition checklist — only present when positionState is FLAT. */
  entryChecklist: {
    adxTrending: { pass: boolean; value: number; threshold: number };
    emaAligned: { pass: boolean; direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' };
    donchianBreakout: { pass: boolean; direction: 'UP' | 'DOWN' | 'NONE' };
    volumeConfirmed: { pass: boolean; ratio: number };
    cooldownClear: { pass: boolean; remaining: number };
  } | null;
  /** Active position details — only present when positionState is LONG or SHORT. */
  activePosition: {
    direction: PositionState;
    entryPrice: number;
    currentPrice: number;
    trailingStop: number;
    distanceToStop: number;
    distancePct: number;
    candlesHeld: number;
    maxHoldingCandles: number;
  } | null;
  cooldownRemaining: number;
  lastSignalAt: number | null;
  lastSignalDirection: string | null;
  lastSignalReason: string | null;
}

interface InternalState {
  positionState: PositionState;
  entryPrice: number;
  /** ATR trailing stop level. Moves up for LONG, down for SHORT, never reverses. */
  trailingStop: number;
  candlesHeld: number;
  cooldownRemaining: number;
  /** Most recent closed-candle values; populated in doOnCandle. */
  lastClose: number;
  lastHigh: number;
  lastLow: number;
  lastVolume: number;
  /**
   * Donchian bands from the PREVIOUS signal-generation call.
   *
   * The Donchian calculator already includes the current candle when it runs, so
   * checking close > currentDonchianUpper would require close > today's intra-candle high —
   * always false. Instead we compare close against the PREVIOUS bands to detect whether
   * today's close broke the prior period's highest high / lowest low.
   */
  prevDonchianUpper: number;
  prevDonchianLower: number;
  /** Fingerprint of the most recent entry signal; prevents identical signal spam. */
  lastEntryFingerprint: string | null;
  // ── Live price (refreshed on every tick) ─────────────────────────────────────
  livePrice: number;
  livePriceAt: number;
  // ── Live indicator snapshot (refreshed every doGenerateSignal call) ──────────
  lastEmaFast: number;
  lastEmaSlow: number;
  lastAtr: number;
  lastAdx: number;
  lastPdi: number;
  lastNdi: number;
  lastVolumeRatio: number;
  lastDonchianUpper: number;
  lastDonchianLower: number;
  // ── Timing ───────────────────────────────────────────────────────────────────
  /** Epoch-ms of the last closed candle received via doOnCandle. 0 = not yet set. */
  lastCandleAt: number;
  // ── Reasoning ────────────────────────────────────────────────────────────────
  lastSignalDirection: string | null;
  lastSignalReason: string | null;
  lastSignalAt: number | null;
  // ── ML feature history ───────────────────────────────────────────────────────
  /**
   * Rolling close-price history, oldest first, capped at 73 entries.
   * Used to compute 1h / 4h / 24h / 72h return features for the ML sidecar.
   * 73 = lookback for ret72h + 1 (the base candle).
   */
  closeHistory: number[];
}

function freshState(): InternalState {
  return {
    positionState: 'FLAT',
    entryPrice: 0,
    trailingStop: 0,
    candlesHeld: 0,
    cooldownRemaining: 0,
    lastClose: 0,
    lastHigh: 0,
    lastLow: 0,
    lastVolume: 0,
    prevDonchianUpper: 0,
    prevDonchianLower: 0,
    lastEntryFingerprint: null,
    livePrice: 0,
    livePriceAt: 0,
    lastEmaFast: 0,
    lastEmaSlow: 0,
    lastAtr: 0,
    lastAdx: 0,
    lastPdi: 0,
    lastNdi: 0,
    lastVolumeRatio: 0,
    lastDonchianUpper: 0,
    lastDonchianLower: 0,
    lastCandleAt: 0,
    lastSignalDirection: null,
    lastSignalReason: null,
    lastSignalAt: null,
    closeHistory: [],
  };
}

export function createTrendFollowingV1Config(
  overrides: Partial<StrategyPluginConfig> = {},
): StrategyPluginConfig {
  return {
    strategyId: 'trend-following-v1',
    name: 'TrendFollowingV1',
    version: '1.0.0',
    parameters: {
      emaPeriodFast: 50,
      emaPeriodSlow: 200,
      atrPeriod: 14,
      atrMultiplier: 2.0,
      atrMinThreshold: 0,
      adxPeriod: 14,
      adxThreshold: 20,      // was 25 — lower threshold catches more trending markets
      donchianWindow: 20,
      volumeMaPeriod: 20,
      cooldownCandles: 3,              // was 10 — 45-min post-stop-loss pause (was 2.5h on 1h)
      maxHoldingCandles: 50,           // was 100 — max 12.5h in a position on 15m
      timeframe: '15m',                // was '1h' — 4× more candle closes per day per symbol
      donchianBreakoutTolerancePct: 0.15, // 15 bps tolerance — catches "sitting at the band" cases
    },
    riskProfile: {
      maxPositionSizePercent: 1,
      maxDrawdownPercent: 5,
      stopLossPercent: 2,
      takeProfitPercent: 6,
      maxOpenOrders: 1,
    },
    enabledSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
    enabledSessions: [],
    resourceLimits: {
      maxRuntimeMs: 500,
      maxEventsPerSecond: 100,
    },
    // Route execution to the paper adapter, not the Binance data-source exchange.
    targetExchange: 'paper_trading',
    ...overrides,
  };
}

/**
 * TrendFollowingV1 — rule-based long-term trend following. No prediction. No AI. No news.
 *
 * ## Entry (all conditions required simultaneously)
 *   1. Market regime   — ADX > adxThreshold (trending market, not ranging)
 *   2. Trend direction — EMA(fast) > EMA(slow) → long only
 *                        EMA(fast) < EMA(slow) → short only
 *   3. Breakout trigger— close > previous Donchian upper (long)
 *                        close < previous Donchian lower (short)
 *   4. Volatility      — ATR > atrMinThreshold (if non-zero)
 *   5. Volume          — current candle volume > volume MA
 *   6. Cooldown        — no stop loss fired within the last cooldownCandles candles
 *   7. Risk engine     — signal suppressed when risk engine rejects (placeholder; deferred to
 *                        a dedicated RiskEngineService not yet built)
 *
 * ## Exit (first condition met wins)
 *   1. ATR trailing stop — stop trails price; fires when close crosses the stop level
 *   2. EMA cross         — EMA fast crosses against position (trend reversal)
 *   3. Max holding time  — position held longer than maxHoldingCandles
 *
 * ## Cooldown
 *   After a stop-loss exit, entry is blocked for cooldownCandles candles.
 *   EMA-cross and max-holding exits do NOT trigger a cooldown.
 *
 * ## Duplicate-signal prevention
 *   An entry signal whose (symbol, direction, Donchian upper, EMA fast) fingerprint matches
 *   the previous emitted entry signal is discarded.
 *
 * ## Signal confidence (0–1)
 *   Weighted composite of ADX strength (40%), breakout distance / ATR (30%), and volume
 *   confirmation (30%).
 *
 * ## Strengths
 *   - Fully rule-based and back-testable
 *   - Trend-regime filter reduces signals in choppy markets
 *   - ATR trailing stop locks in profits during sustained trends
 *
 * ## Weaknesses
 *   - Whipsaws on sudden reversals; ADX lags
 *   - Donchian breakouts can be false in low-ADX sideways moves
 *   - Requires full indicator warmup before the first valid signal
 *
 * This strategy generates signals only — it never submits orders.
 */
export class TrendFollowingV1Strategy extends BaseStrategy {
  private readonly params: TrendFollowingV1Params;
  /**
   * Independent state per trading symbol.
   *
   * Each symbol in enabledSymbols gets its own InternalState so that BTC and
   * ETH position tracking, cooldowns, and indicator snapshots never bleed into
   * each other. State is lazily created on first candle/tick for a symbol.
   */
  private readonly stateBySymbol = new Map<string, InternalState>();

  constructor(
    config: StrategyPluginConfig,
    /**
     * Optional ML signal sidecar client.  When provided, candidate entry signals
     * are scored before the position state is committed.  When absent (or when the
     * sidecar is unreachable), every signal passes through unmodified — backtest and
     * optimisation runs are unaffected.
     */
    private readonly mlSignal?: MlSignalService,
  ) {
    super(config);
    this.params = config.parameters as unknown as TrendFollowingV1Params;
  }

  /** Lazily create and return the per-symbol state. */
  private getState(symbol: string): InternalState {
    if (!this.stateBySymbol.has(symbol)) {
      this.stateBySymbol.set(symbol, freshState());
    }
    return this.stateBySymbol.get(symbol)!;
  }

  protected override doValidateConfiguration(
    config: StrategyPluginConfig,
  ): Result<void, StrategyConfigValidationError> {
    const p = config.parameters as unknown as TrendFollowingV1Params;
    const id = config.strategyId;

    const mustBePositive = (name: string): Result<void, StrategyConfigValidationError> =>
      err(new StrategyConfigValidationError(id, `${name} must be a positive number`));

    if (!(p.emaPeriodFast > 0)) return mustBePositive('emaPeriodFast');
    if (!(p.emaPeriodSlow > 0)) return mustBePositive('emaPeriodSlow');
    if (p.emaPeriodFast >= p.emaPeriodSlow)
      return err(
        new StrategyConfigValidationError(id, 'emaPeriodFast must be less than emaPeriodSlow'),
      );
    if (!(p.atrPeriod > 0)) return mustBePositive('atrPeriod');
    if (!(p.atrMultiplier > 0)) return mustBePositive('atrMultiplier');
    if (p.atrMinThreshold < 0)
      return err(new StrategyConfigValidationError(id, 'atrMinThreshold must be non-negative'));
    if (!(p.adxPeriod > 0)) return mustBePositive('adxPeriod');
    if (!(p.adxThreshold > 0)) return mustBePositive('adxThreshold');
    if (!(p.donchianWindow > 0)) return mustBePositive('donchianWindow');
    if (!(p.volumeMaPeriod > 0)) return mustBePositive('volumeMaPeriod');
    if (p.cooldownCandles < 0)
      return err(new StrategyConfigValidationError(id, 'cooldownCandles must be non-negative'));
    if (!(p.maxHoldingCandles > 0)) return mustBePositive('maxHoldingCandles');
    if (!p.timeframe) return err(new StrategyConfigValidationError(id, 'timeframe is required'));
    if (p.donchianBreakoutTolerancePct < 0)
      return err(new StrategyConfigValidationError(id, 'donchianBreakoutTolerancePct must be non-negative'));

    return ok(undefined);
  }

  protected override async onInitialize(): Promise<void> {
    // Clear per-symbol state so a re-initialize starts fresh for every symbol.
    this.stateBySymbol.clear();
  }

  /**
   * Capture the latest mid-price for each enabled symbol from the live tick feed.
   * This runs on every best bid/ask update — far more frequently than 1h candle closes —
   * so the monitoring dashboard always has a near-real-time price to display.
   */
  protected override async doOnTick(tick: MarketTick): Promise<void> {
    const sym = String(tick.symbol);
    if (!this.config.enabledSymbols.includes(sym)) return;
    const st = this.getState(sym);
    st.livePrice = tick.midPrice;
    st.livePriceAt = tick.timestamp.getTime();
  }

  /**
   * Tracks candle close/high/low/volume for use in doGenerateSignal.
   * Also advances the candles-held counter when in a position.
   * Ignores candles whose timeframe does not match the configured timeframe.
   *
   * Cooldown is decremented in doGenerateSignal, not here, so that cooldownCandles
   * maps exactly to "N generateSignal calls are suppressed after a stop-loss exit."
   */
  protected override async doOnCandle(candle: Candle): Promise<void> {
    if (candle.timeframe !== (this.params.timeframe as Candle['timeframe'])) return;

    const st = this.getState(candle.symbol);
    st.lastClose = candle.close;
    st.lastHigh = candle.high;
    st.lastLow = candle.low;
    st.lastVolume = candle.volume;
    st.lastCandleAt = candle.closeTime;

    // Rolling close history for ML return features (oldest first, max 73 entries)
    st.closeHistory.push(candle.close);
    if (st.closeHistory.length > 73) st.closeHistory.shift();

    if (st.positionState !== 'FLAT') st.candlesHeld++;
  }

  /**
   * Core signal-generation hook.
   *
   * Called by the scheduler after each candle. Reads all indicator values from context,
   * evaluates exit conditions first (if in a position), then entry conditions (if flat),
   * and returns at most one signal per call.
   *
   * Always null when:
   *   - No candle has been received yet
   *   - Any required indicator is missing from context
   *   - This is the first call (prevDonchian baseline not yet established)
   */
  protected override async doGenerateSignal(context: StrategyContext): Promise<Signal | null> {
    const { symbol } = context;
    const st = this.getState(symbol);

    if (st.lastClose === 0) return null;

    const p = this.params;
    const tf = p.timeframe;

    const emaFast = context.indicators.get(
      `${IndicatorType.EMA}:${symbol}:${tf}:${p.emaPeriodFast}`,
    ) as EmaValue | undefined;
    const emaSlow = context.indicators.get(
      `${IndicatorType.EMA}:${symbol}:${tf}:${p.emaPeriodSlow}`,
    ) as EmaValue | undefined;
    const atr = context.indicators.get(`${IndicatorType.ATR}:${symbol}:${tf}:${p.atrPeriod}`) as
      AtrValue | undefined;
    const adx = context.indicators.get(`${IndicatorType.ADX}:${symbol}:${tf}:${p.adxPeriod}`) as
      AdxValue | undefined;
    const donchian = context.indicators.get(
      `${IndicatorType.DONCHIAN}:${symbol}:${tf}:${p.donchianWindow}`,
    ) as DonchianValue | undefined;
    const volumeMa = context.indicators.get(
      `${IndicatorType.VOLUME_MA}:${symbol}:${tf}:${p.volumeMaPeriod}`,
    ) as VolumeMaValue | undefined;

    if (!emaFast || !emaSlow || !atr || !adx || !donchian || !volumeMa) return null;

    // ── Snapshot current indicator values for monitoring ─────────────────────
    st.lastEmaFast = emaFast.value;
    st.lastEmaSlow = emaSlow.value;
    st.lastAtr = atr.value;
    st.lastAdx = adx.adx;
    st.lastPdi = adx.pdi;
    st.lastNdi = adx.ndi;
    st.lastVolumeRatio = volumeMa.value > 0 ? st.lastVolume / volumeMa.value : 0;
    st.lastDonchianUpper = donchian.upper;
    st.lastDonchianLower = donchian.lower;

    let signal: Signal | null = null;

    if (st.positionState !== 'FLAT') {
      signal = this.evaluateExit(st, context, emaFast, emaSlow, atr);
    } else if (st.cooldownRemaining > 0) {
      // Cooldown after stop-loss: decrement counter and skip entry.
      // Decrement happens here (not in doOnCandle) so cooldownCandles maps exactly to
      // "N generateSignal calls are suppressed."
      st.cooldownRemaining--;
    } else if (st.prevDonchianUpper !== 0) {
      // prevDonchianUpper === 0 on the very first call (no baseline yet) — skip and record.
      //
      // ML pre-filter: score the candidate entry BEFORE calling evaluateEntry so that
      // a rejection does not mutate position state (evaluateEntry commits state on entry).
      // The filter is skipped when mlSignal is absent or when the sidecar is unavailable
      // (the service returns the pass-through fallback in both cases).
      let mlApproved = true;
      if (this.mlSignal) {
        const features = this.buildMlFeatures(st, context, emaFast, emaSlow, atr, adx, donchian);
        const prediction = await this.mlSignal.score(features);
        if (prediction.signal === 'skip') {
          mlApproved = false;
          console.log(
            `[TFV1:${symbol}] ML filtered entry — confidence=${prediction.confidence.toFixed(2)} (${prediction.modelVersion})`,
          );
        }
      }

      if (mlApproved) {
        signal = this.evaluateEntry(
          st,
          context,
          emaFast,
          emaSlow,
          atr,
          adx,
          donchian,
          volumeMa,
          st.lastClose,
        );
      }
    }

    // Record signal metadata for monitoring
    if (signal !== null) {
      st.lastSignalDirection = signal.direction;
      st.lastSignalReason = signal.reason;
      st.lastSignalAt = Date.now();
    }

    // Always advance the Donchian baseline after evaluation
    st.prevDonchianUpper = donchian.upper;
    st.prevDonchianLower = donchian.lower;

    return signal;
  }

  // ---------------------------------------------------------------------------
  // Exit evaluation
  // ---------------------------------------------------------------------------

  private evaluateExit(
    st: InternalState,
    context: StrategyContext,
    emaFast: EmaValue,
    emaSlow: EmaValue,
    atr: AtrValue,
  ): Signal | null {
    const close = st.lastClose;
    const isLong = st.positionState === 'LONG';

    // Update ATR trailing stop: only moves in the favourable direction
    if (isLong) {
      const candidate = close - atr.value * this.params.atrMultiplier;
      if (candidate > st.trailingStop) st.trailingStop = candidate;
    } else {
      const candidate = close + atr.value * this.params.atrMultiplier;
      if (candidate < st.trailingStop) st.trailingStop = candidate;
    }

    let reason: string | null = null;
    let isStopLoss = false;

    // 1. ATR trailing stop
    if (isLong && close < st.trailingStop) {
      reason = `ATR trailing stop hit — stop=${st.trailingStop.toFixed(4)}, close=${close.toFixed(4)}`;
      isStopLoss = true;
    } else if (!isLong && close > st.trailingStop) {
      reason = `ATR trailing stop hit — stop=${st.trailingStop.toFixed(4)}, close=${close.toFixed(4)}`;
      isStopLoss = true;
    }

    // 2. EMA cross against position (trend reversal)
    if (!reason) {
      if (isLong && emaFast.value < emaSlow.value) {
        reason =
          `EMA bearish cross — EMA${this.params.emaPeriodFast}(${emaFast.value.toFixed(4)})` +
          ` < EMA${this.params.emaPeriodSlow}(${emaSlow.value.toFixed(4)})`;
      } else if (!isLong && emaFast.value > emaSlow.value) {
        reason =
          `EMA bullish cross — EMA${this.params.emaPeriodFast}(${emaFast.value.toFixed(4)})` +
          ` > EMA${this.params.emaPeriodSlow}(${emaSlow.value.toFixed(4)})`;
      }
    }

    // 3. Maximum holding time
    if (!reason && st.candlesHeld >= this.params.maxHoldingCandles) {
      reason = `Maximum holding time reached (${st.candlesHeld} candles)`;
    }

    if (!reason) return null;

    const signal = this.buildSignal(context, SignalDirection.EXIT, reason, 1.0, {
      trailingStop: st.trailingStop,
      entryPrice: st.entryPrice,
      candlesHeld: st.candlesHeld,
      atr: atr.value,
      emaFast: emaFast.value,
      emaSlow: emaSlow.value,
    });

    // Reset position state
    st.positionState = 'FLAT';
    st.entryPrice = 0;
    st.trailingStop = 0;
    st.candlesHeld = 0;
    st.lastEntryFingerprint = null; // allow re-entry after a fresh breakout
    if (isStopLoss) st.cooldownRemaining = this.params.cooldownCandles;

    return signal;
  }

  // ---------------------------------------------------------------------------
  // Entry evaluation
  // ---------------------------------------------------------------------------

  private evaluateEntry(
    st: InternalState,
    context: StrategyContext,
    emaFast: EmaValue,
    emaSlow: EmaValue,
    atr: AtrValue,
    adx: AdxValue,
    donchian: DonchianValue,
    volumeMa: VolumeMaValue,
    close: number,
  ): Signal | null {
    const { adxThreshold, atrMinThreshold, emaPeriodFast, emaPeriodSlow, donchianBreakoutTolerancePct } = this.params;

    // 1. Market regime: ADX must confirm trending conditions
    if (adx.adx <= adxThreshold) return null;

    // 2. Volatility: ATR must exceed the minimum threshold (if configured)
    if (atrMinThreshold > 0 && atr.value < atrMinThreshold) return null;

    // 3. Volume: current candle volume must exceed its moving average
    if (st.lastVolume <= volumeMa.value) return null;

    // 4. Trend direction + Donchian breakout
    //    Breakout is validated against the PREVIOUS Donchian bands because the current
    //    Donchian already incorporates today's candle high/low, making close > upper impossible.
    //
    //    A small tolerance (donchianBreakoutTolerancePct) is applied so that price sitting
    //    within that many basis points of the band still qualifies — catching the common case
    //    where the close is $1–$40 below the level but all other conditions are green.
    const tol = donchianBreakoutTolerancePct / 100;
    const upperThreshold = st.prevDonchianUpper * (1 - tol);
    const lowerThreshold = st.prevDonchianLower * (1 + tol);

    let direction: SignalDirection | null = null;
    if (emaFast.value > emaSlow.value && close >= upperThreshold) {
      direction = SignalDirection.BUY;
    } else if (emaFast.value < emaSlow.value && close <= lowerThreshold) {
      direction = SignalDirection.SELL;
    }
    if (!direction) return null;

    // 5. Duplicate-signal prevention
    const fingerprint =
      `${context.symbol}:${direction}:` +
      `${st.prevDonchianUpper.toFixed(4)}:${emaFast.value.toFixed(4)}`;
    if (fingerprint === st.lastEntryFingerprint) return null;

    const breakoutDist =
      direction === SignalDirection.BUY
        ? close - st.prevDonchianUpper
        : st.prevDonchianLower - close;

    const confidence = this.computeConfidence(adx, atr, breakoutDist);
    const trendWord = direction === SignalDirection.BUY ? 'Uptrend' : 'Downtrend';
    const bandWord = direction === SignalDirection.BUY ? 'upper' : 'lower';
    const reason =
      `${trendWord} — EMA${emaPeriodFast}/EMA${emaPeriodSlow} aligned, ` +
      `Donchian ${bandWord} breakout, ADX=${adx.adx.toFixed(1)}`;

    const signal = this.buildSignal(context, direction, reason, confidence, {
      emaFast: emaFast.value,
      emaSlow: emaSlow.value,
      atr: atr.value,
      adx: adx.adx,
      pdi: adx.pdi,
      ndi: adx.ndi,
      donchianUpper: donchian.upper,
      donchianLower: donchian.lower,
      prevDonchianUpper: st.prevDonchianUpper,
      prevDonchianLower: st.prevDonchianLower,
      volume: st.lastVolume,
      volumeMa: volumeMa.value,
      breakoutDistance: breakoutDist,
    });

    // Transition to position
    st.positionState = direction === SignalDirection.BUY ? 'LONG' : 'SHORT';
    st.entryPrice = close;
    st.candlesHeld = 0;
    st.trailingStop =
      direction === SignalDirection.BUY
        ? close - atr.value * this.params.atrMultiplier
        : close + atr.value * this.params.atrMultiplier;
    st.lastEntryFingerprint = fingerprint;

    return signal;
  }

  // ---------------------------------------------------------------------------
  // Monitoring: strategy "thought" snapshots (one per symbol)
  // ---------------------------------------------------------------------------

  /**
   * Returns one thought snapshot per active symbol.
   *
   * Each snapshot describes what the strategy is currently "thinking" for that symbol:
   * its internal state, live tick price, latest 1h indicator values, and a plain-English
   * explanation of why it is or isn't entering a position.
   *
   * Live price (`livePrice`) is updated on every best bid/ask tick — far more frequently
   * than 1h candle closes — so the dashboard displays a near-real-time price even when
   * the strategy hasn't evaluated a new signal yet.
   *
   * Zero side-effects, read-only.
   */
  getThought(): StrategyThought[] {
    // Return one thought per configured symbol, even before the first candle arrives.
    return this.config.enabledSymbols.map((symbol) =>
      this.buildThoughtForSymbol(symbol, this.getState(symbol)),
    );
  }

  private buildThoughtForSymbol(symbol: string, st: InternalState): StrategyThought {
    const p = this.params;
    const hasIndicators = st.lastEmaFast !== 0;
    const livePrice = st.livePrice > 0 ? st.livePrice : null;
    const livePriceAt = st.livePriceAt > 0 ? st.livePriceAt : null;

    // ── Indicators ────────────────────────────────────────────────────────────
    const indicators: StrategyThought['indicators'] = hasIndicators
      ? {
          emaFast: st.lastEmaFast,
          emaSlow: st.lastEmaSlow,
          emaTrend:
            st.lastEmaFast > st.lastEmaSlow
              ? 'BULLISH'
              : st.lastEmaFast < st.lastEmaSlow
                ? 'BEARISH'
                : 'NEUTRAL',
          atr: st.lastAtr,
          adx: st.lastAdx,
          adxTrending: st.lastAdx > p.adxThreshold,
          pdi: st.lastPdi,
          ndi: st.lastNdi,
          donchianUpper: st.lastDonchianUpper,
          donchianLower: st.lastDonchianLower,
          volumeRatio: st.lastVolumeRatio,
          volumeConfirmed: st.lastVolumeRatio > 1,
        }
      : null;

    // ── Mode & summary ────────────────────────────────────────────────────────
    if (!hasIndicators) {
      return {
        strategyId: this.id,
        symbol,
        livePrice,
        livePriceAt,
        indicatorsUpdatedAt: st.lastCandleAt || null,
        positionState: st.positionState,
        mode: 'NO_DATA',
        summary: 'Waiting for indicator warmup — no candle data yet',
        indicators: null,
        entryChecklist: null,
        activePosition: null,
        cooldownRemaining: 0,
        lastSignalAt: st.lastSignalAt,
        lastSignalDirection: st.lastSignalDirection,
        lastSignalReason: st.lastSignalReason,
      };
    }

    // ── In a position ─────────────────────────────────────────────────────────
    if (st.positionState !== 'FLAT') {
      const isLong = st.positionState === 'LONG';
      const distToStop = isLong
        ? st.lastClose - st.trailingStop
        : st.trailingStop - st.lastClose;
      const distPct = st.lastClose > 0 ? (distToStop / st.lastClose) * 100 : 0;
      const candlesLeft = p.maxHoldingCandles - st.candlesHeld;
      // Use live price for the current price display if available; fall back to last close.
      const currentPrice = livePrice ?? st.lastClose;
      const summary =
        `Managing ${st.positionState} from $${st.entryPrice.toFixed(2)} — ` +
        `trailing stop at $${st.trailingStop.toFixed(2)} (${distPct.toFixed(2)}% away), ` +
        `${st.candlesHeld}/${p.maxHoldingCandles} candles held (${candlesLeft} left)`;
      return {
        strategyId: this.id,
        symbol,
        livePrice,
        livePriceAt,
        indicatorsUpdatedAt: st.lastCandleAt || null,
        positionState: st.positionState,
        mode: 'IN_POSITION',
        summary,
        indicators,
        entryChecklist: null,
        activePosition: {
          direction: st.positionState,
          entryPrice: st.entryPrice,
          currentPrice,
          trailingStop: st.trailingStop,
          distanceToStop: distToStop,
          distancePct: distPct,
          candlesHeld: st.candlesHeld,
          maxHoldingCandles: p.maxHoldingCandles,
        },
        cooldownRemaining: 0,
        lastSignalAt: st.lastSignalAt,
        lastSignalDirection: st.lastSignalDirection,
        lastSignalReason: st.lastSignalReason,
      };
    }

    // ── Cooldown ──────────────────────────────────────────────────────────────
    if (st.cooldownRemaining > 0) {
      return {
        strategyId: this.id,
        symbol,
        livePrice,
        livePriceAt,
        indicatorsUpdatedAt: st.lastCandleAt || null,
        positionState: 'FLAT',
        mode: 'COOLDOWN',
        summary: `Cooling down after stop-loss — ${st.cooldownRemaining} more candle(s) before re-entry is allowed`,
        indicators,
        entryChecklist: null,
        activePosition: null,
        cooldownRemaining: st.cooldownRemaining,
        lastSignalAt: st.lastSignalAt,
        lastSignalDirection: st.lastSignalDirection,
        lastSignalReason: st.lastSignalReason,
      };
    }

    // ── Scanning for entry ────────────────────────────────────────────────────
    const adxPass = st.lastAdx > p.adxThreshold;
    const emaTrend =
      st.lastEmaFast > st.lastEmaSlow
        ? 'BULLISH'
        : st.lastEmaFast < st.lastEmaSlow
          ? 'BEARISH'
          : 'NEUTRAL';
    const emaAligned = emaTrend !== 'NEUTRAL';

    // Mirror the tolerance logic from evaluateEntry so the dashboard matches what actually fires.
    const monTol = p.donchianBreakoutTolerancePct / 100;
    const monUpperThreshold = st.prevDonchianUpper > 0 ? st.prevDonchianUpper * (1 - monTol) : 0;
    const monLowerThreshold = st.prevDonchianLower > 0 ? st.prevDonchianLower * (1 + monTol) : 0;
    const breakoutUp = monUpperThreshold > 0 && st.lastClose >= monUpperThreshold && emaTrend === 'BULLISH';
    const breakoutDown = monLowerThreshold > 0 && st.lastClose <= monLowerThreshold && emaTrend === 'BEARISH';
    const donchianBreakout = breakoutUp || breakoutDown;
    const volOk = st.lastVolumeRatio > 1;

    // Build a plain-English summary of what's blocking entry
    const blockers: string[] = [];
    if (!adxPass) blockers.push(`ADX ${st.lastAdx.toFixed(1)} < ${p.adxThreshold} (market ranging)`);
    if (!emaAligned) blockers.push('EMA trend is flat');
    if (emaAligned && !donchianBreakout) {
      const word = emaTrend === 'BULLISH' ? 'upper' : 'lower';
      const rawBand = emaTrend === 'BULLISH' ? st.prevDonchianUpper : st.prevDonchianLower;
      const threshold = emaTrend === 'BULLISH' ? monUpperThreshold : monLowerThreshold;
      blockers.push(
        `No Donchian ${word} breakout (close $${st.lastClose.toFixed(2)} vs threshold $${threshold.toFixed(2)} / band $${rawBand.toFixed(2)})`,
      );
    }
    if (!volOk) blockers.push(`Volume ${(st.lastVolumeRatio * 100).toFixed(0)}% of MA (< 100%)`);

    // "conditions met" is evaluated against prevDonchian (updated at end of last generateSignal),
    // so it reflects what the NEXT close will be evaluated against — not whether the last close
    // already fired. The message correctly says "imminent" (not "fired").
    const entryWord = emaTrend === 'BEARISH' ? 'SHORT' : 'LONG';
    const levelStr =
      emaTrend === 'BEARISH'
        ? `≤ $${monLowerThreshold.toFixed(2)}`
        : `≥ $${monUpperThreshold.toFixed(2)}`;
    const summary = blockers.length === 0
      ? `Ready to enter ${entryWord} — fires when next ${p.timeframe} candle closes ${levelStr}`
      : `Scanning — blocked by: ${blockers.join(' · ')}`;

    return {
      strategyId: this.id,
      symbol,
      livePrice,
      livePriceAt,
      indicatorsUpdatedAt: st.lastCandleAt || null,
      positionState: 'FLAT',
      mode: 'SCANNING',
      summary,
      indicators,
      entryChecklist: {
        adxTrending: { pass: adxPass, value: st.lastAdx, threshold: p.adxThreshold },
        emaAligned: { pass: emaAligned, direction: emaTrend },
        donchianBreakout: {
          pass: donchianBreakout,
          direction: breakoutUp ? 'UP' : breakoutDown ? 'DOWN' : 'NONE',
        },
        volumeConfirmed: { pass: volOk, ratio: st.lastVolumeRatio },
        cooldownClear: { pass: true, remaining: 0 },
      },
      activePosition: null,
      cooldownRemaining: 0,
      lastSignalAt: st.lastSignalAt,
      lastSignalDirection: st.lastSignalDirection,
      lastSignalReason: st.lastSignalReason,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // ML feature extraction
  // ---------------------------------------------------------------------------

  /**
   * Build the 12-feature SignalFeatures vector sent to the ML sidecar.
   *
   * All features are derived from indicators already computed by the strategy —
   * no extra indicator lookups are required.  Features unavailable due to
   * insufficient history are zeroed (the model handles neutral input gracefully).
   *
   * The ML call happens BEFORE evaluateEntry commits any position state.
   */
  private buildMlFeatures(
    st: InternalState,
    context: StrategyContext,
    emaFast: EmaValue,
    emaSlow: EmaValue,
    atr: AtrValue,
    adx: AdxValue,
    donchian: DonchianValue,
  ): SignalFeatures {
    const close = st.lastClose;
    const hist = st.closeHistory; // oldest first, max 73 entries
    const n = hist.length;

    // ── Price momentum (returns) ──────────────────────────────────────────────
    const ret = (lookback: number): number => {
      if (n <= lookback) return 0;
      const base = hist[n - 1 - lookback];
      return base !== 0 ? close / base - 1 : 0;
    };

    // ── Time features (UTC) ───────────────────────────────────────────────────
    const dt = new Date(context.timestamp);
    const hour = dt.getUTCHours() + dt.getUTCMinutes() / 60;
    const dow = dt.getUTCDay(); // 0 = Sunday, 6 = Saturday

    // ── Donchian channel position [0, 1] ─────────────────────────────────────
    const donRange = donchian.upper - donchian.lower;
    const donPos = donRange > 0 ? (close - donchian.lower) / donRange : 0.5;

    // ── RSI(14) from close history ────────────────────────────────────────────
    const rsi14 = this.computeRsi(hist, 14);

    // ── PDI/NDI directional conviction: (pdi − ndi) / (pdi + ndi) ──────────
    const pdiNdiSum = adx.pdi + adx.ndi;
    const pdiNdiRatio = pdiNdiSum > 0 ? (adx.pdi - adx.ndi) / pdiNdiSum : 0;

    return {
      ret1h: ret(1),
      ret4h: ret(4),
      ret24h: ret(24),
      ret72h: ret(72),
      atrNorm: close > 0 ? atr.value / close : 0,
      volRatio: st.lastVolumeRatio,
      emaSpread: emaSlow.value > 0 ? (emaFast.value - emaSlow.value) / emaSlow.value : 0,
      adx: adx.adx,
      donPos,
      hourSin: Math.sin((2 * Math.PI * hour) / 24),
      hourCos: Math.cos((2 * Math.PI * hour) / 24),
      dowSin: Math.sin((2 * Math.PI * dow) / 7),
      rsi14,
      pdiNdiRatio,
    };
  }

  /**
   * Confidence is a weighted composite of three independent factors:
   *   40% — ADX strength above threshold (normalised to [0, 1] over a 35-point range)
   *   30% — Breakout distance relative to 2×ATR (how far price is past the breakout level)
   *   30% — Volume confirmation (fixed at 0.7; volume filter is already enforced before entry)
   */
  private computeConfidence(adx: AdxValue, atr: AtrValue, breakoutDist: number): number {
    const adxScore = Math.min(Math.max((adx.adx - this.params.adxThreshold) / 35, 0), 1);
    const distScore = atr.value > 0 ? Math.min(breakoutDist / (atr.value * 2), 1) : 0;
    const volScore = 0.7;
    return Math.max(0, Math.min(1, adxScore * 0.4 + distScore * 0.3 + volScore * 0.3));
  }

  /**
   * Wilder's RSI from a raw close-price array (oldest first).
   *
   * Mirrors the Python _compute_rsi() in features.py so training and inference
   * produce identical values.  Returns 50 when there is insufficient history —
   * the model treats this as a neutral (non-predictive) feature.
   */
  private computeRsi(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;

    // Exponential smoothing with alpha = 1/period (Wilder's method)
    const alpha = 1 / period;
    let avgGain = 0;
    let avgLoss = 0;

    // Seed the first average over the first `period` deltas
    for (let i = 1; i <= period; i++) {
      const delta = closes[i] - closes[i - 1];
      if (delta > 0) avgGain += delta;
      else avgLoss -= delta;
    }
    avgGain /= period;
    avgLoss /= period;

    // Continue the Wilder EMA over the remaining bars
    for (let i = period + 1; i < closes.length; i++) {
      const delta = closes[i] - closes[i - 1];
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? -delta : 0;
      avgGain = avgGain * (1 - alpha) + gain * alpha;
      avgLoss = avgLoss * (1 - alpha) + loss * alpha;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private buildSignal(
    context: StrategyContext,
    direction: SignalDirection,
    reason: string,
    confidence: number,
    metadata: Record<string, unknown>,
  ): Signal {
    return {
      signalId: randomUUID(),
      timestamp: context.timestamp,
      strategyId: this.id,
      // Use the configured execution target (e.g. paper_trading) rather than the
      // candle's source exchange (e.g. binance_spot). Market data comes from Binance
      // but orders are routed to whichever adapter is registered as targetExchange.
      exchange: this.config.targetExchange ?? context.exchange,
      symbol: context.symbol,
      direction,
      confidence,
      reason,
      metadata,
    };
  }
}
