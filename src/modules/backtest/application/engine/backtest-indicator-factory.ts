import { Injectable } from '@nestjs/common';
import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { IIndicatorCalculator } from '@modules/indicator/interfaces/indicator-calculator.interface';
import {
  EmaCalculator,
  createEmaConfig,
} from '@modules/indicator/infrastructure/calculators/ema/ema.calculator';
import {
  SmaCalculator,
  createSmaConfig,
} from '@modules/indicator/infrastructure/calculators/sma/sma.calculator';
import {
  AtrCalculator,
  createAtrConfig,
} from '@modules/indicator/infrastructure/calculators/atr/atr.calculator';
import {
  RsiCalculator,
  createRsiConfig,
} from '@modules/indicator/infrastructure/calculators/rsi/rsi.calculator';
import {
  AdxCalculator,
  createAdxConfig,
} from '@modules/indicator/infrastructure/calculators/adx/adx.calculator';
import {
  VwapCalculator,
  createVwapConfig,
} from '@modules/indicator/infrastructure/calculators/vwap/vwap.calculator';
import {
  DonchianCalculator,
  createDonchianConfig,
} from '@modules/indicator/infrastructure/calculators/donchian/donchian.calculator';
import {
  BollingerCalculator,
  createBollingerConfig,
} from '@modules/indicator/infrastructure/calculators/bollinger/bollinger.calculator';
import {
  MacdCalculator,
  createMacdConfig,
} from '@modules/indicator/infrastructure/calculators/macd/macd.calculator';
import {
  SupertrendCalculator,
  createSupertrendConfig,
} from '@modules/indicator/infrastructure/calculators/supertrend/supertrend.calculator';
import {
  VolumeMaCalculator,
  createVolumeMaConfig,
} from '@modules/indicator/infrastructure/calculators/volume-ma/volume-ma.calculator';
import {
  VolumeSpikeCalculator,
  createVolumeSpikeConfig,
} from '@modules/indicator/infrastructure/calculators/volume-spike/volume-spike.calculator';
import {
  TrueRangeCalculator,
  createTrueRangeConfig,
} from '@modules/indicator/infrastructure/calculators/true-range/true-range.calculator';
import {
  HighestHighCalculator,
  createHighestHighConfig,
} from '@modules/indicator/infrastructure/calculators/highest-high/highest-high.calculator';
import {
  LowestLowCalculator,
  createLowestLowConfig,
} from '@modules/indicator/infrastructure/calculators/lowest-low/lowest-low.calculator';
import { ExtraIndicatorPeriods } from '../../domain/models/backtest-config.model';

/**
 * No-op hash service used for backtest calculators.
 *
 * Backtest indicators are ephemeral — they are created fresh for each session,
 * feed candles in order, and are discarded at the end. They do not need to
 * persist state to Redis (that is only needed for the live indicator pipeline).
 */
const NOOP_HASH_SERVICE = {
  set: async () => {},
  setMultiple: async () => {},
  get: async () => null,
  getAll: async () => null,
  delete: async () => 0,
  exists: async () => false,
  increment: async () => 0,
  getFields: async () => [],
  setWithExpiry: async () => {},
} as unknown as RedisHashService;

/** Default EMA periods always created. Covers the most common strategy configurations. */
const DEFAULT_EMA_PERIODS = [9, 21, 50, 200] as const;
const DEFAULT_SMA_PERIODS = [20, 50] as const;
const DEFAULT_ATR_PERIODS = [14, 21] as const;
const DEFAULT_ADX_PERIODS = [14] as const;
const DEFAULT_DONCHIAN_PERIODS = [20] as const;
const DEFAULT_VOLUME_MA_PERIODS = [20] as const;
const DEFAULT_VOLUME_SPIKE_PERIODS = [20] as const;
const DEFAULT_HIGHEST_HIGH_PERIODS = [20] as const;
const DEFAULT_LOWEST_LOW_PERIODS = [20] as const;

/** Merge defaults with extras, de-duplicate, and sort ascending. */
function merge(defaults: ReadonlyArray<number>, extras: ReadonlyArray<number> | undefined): number[] {
  return [...new Set([...defaults, ...(extras ?? [])])].sort((a, b) => a - b);
}

@Injectable()
export class BacktestIndicatorFactory {
  /**
   * Create one indicator calculator per required period for a given symbol and timeframe.
   *
   * The `extra` parameter is provided by the parameter optimizer to inject calculator
   * instances for periods outside the default set. This ensures that a strategy combo
   * using e.g. EMA-8 or Donchian-50 finds its calculator in the indicator context map.
   *
   * Default periods (always created):
   *   EMA      — 9, 21, 50, 200
   *   SMA      — 20, 50
   *   ATR      — 14, 21
   *   ADX      — 14
   *   Donchian — 20
   *   VolumeMa — 20
   *   … plus fixed-config indicators (RSI-14, VWAP, Bollinger-20, MACD, Supertrend, etc.)
   */
  createForSymbol(
    symbol: string,
    _exchange: string,
    timeframe: Timeframe,
    extra?: ExtraIndicatorPeriods,
  ): IIndicatorCalculator[] {
    const h = NOOP_HASH_SERVICE;

    const emaPeriods = merge(DEFAULT_EMA_PERIODS, extra?.ema);
    const smaPeriods = merge(DEFAULT_SMA_PERIODS, []);         // SMA periods are not swept
    const atrPeriods = merge(DEFAULT_ATR_PERIODS, extra?.atr);
    const adxPeriods = merge(DEFAULT_ADX_PERIODS, extra?.adx);
    const donchianPeriods = merge(DEFAULT_DONCHIAN_PERIODS, extra?.donchian);
    const volumeMaPeriods = merge(DEFAULT_VOLUME_MA_PERIODS, extra?.volumeMa);

    const calculators: IIndicatorCalculator[] = [
      // ── Parametric — one per period ────────────────────────────────────────
      ...emaPeriods.map((p) => new EmaCalculator(createEmaConfig(symbol, timeframe, p), h)),
      ...smaPeriods.map((p) => new SmaCalculator(createSmaConfig(symbol, timeframe, p), h)),
      ...atrPeriods.map((p) => new AtrCalculator(createAtrConfig(symbol, timeframe, p), h)),
      ...adxPeriods.map((p) => new AdxCalculator(createAdxConfig(symbol, timeframe, p), h)),
      ...donchianPeriods.map((p) => new DonchianCalculator(createDonchianConfig(symbol, timeframe, p), h)),
      ...volumeMaPeriods.map((p) => new VolumeMaCalculator(createVolumeMaConfig(symbol, timeframe, p), h)),

      // ── Fixed-config indicators ────────────────────────────────────────────
      new RsiCalculator(createRsiConfig(symbol, timeframe, 14), h),
      new VwapCalculator(createVwapConfig(symbol, timeframe), h),
      new BollingerCalculator(createBollingerConfig(symbol, timeframe, 20), h),
      new MacdCalculator(createMacdConfig(symbol, timeframe), h),
      new SupertrendCalculator(createSupertrendConfig(symbol, timeframe), h),
      ...DEFAULT_VOLUME_SPIKE_PERIODS.map((p) => new VolumeSpikeCalculator(createVolumeSpikeConfig(symbol, timeframe, p), h)),
      new TrueRangeCalculator(createTrueRangeConfig(symbol, timeframe), h),
      ...DEFAULT_HIGHEST_HIGH_PERIODS.map((p) => new HighestHighCalculator(createHighestHighConfig(symbol, timeframe, p), h)),
      ...DEFAULT_LOWEST_LOW_PERIODS.map((p) => new LowestLowCalculator(createLowestLowConfig(symbol, timeframe, p), h)),
    ];

    for (const calc of calculators) {
      calc.initialize();
    }

    return calculators;
  }
}
