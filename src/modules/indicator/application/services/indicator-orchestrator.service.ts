import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorConfig } from '@config/indicator.config';
import { Timeframe } from '../../domain/enums/timeframe.enum';
import { IndicatorType } from '../../domain/enums/indicator-type.enum';
import { IndicatorRegistryService } from '../../infrastructure/registry/indicator-registry.service';
import { WarmupService } from './warmup.service';
import { StrategySchedulerService } from '@modules/strategy/scheduler/strategy-scheduler.service';
import { StrategyContext } from '@modules/strategy/interfaces/strategy.interface';
import { IndicatorValue } from '../../domain/models/indicator-value.model';
import { Candle } from '../../domain/models/candle.model';

import {
  EmaCalculator,
  createEmaConfig,
} from '../../infrastructure/calculators/ema/ema.calculator';
import {
  SmaCalculator,
  createSmaConfig,
} from '../../infrastructure/calculators/sma/sma.calculator';
import {
  AtrCalculator,
  createAtrConfig,
} from '../../infrastructure/calculators/atr/atr.calculator';
import {
  RsiCalculator,
  createRsiConfig,
} from '../../infrastructure/calculators/rsi/rsi.calculator';
import {
  AdxCalculator,
  createAdxConfig,
} from '../../infrastructure/calculators/adx/adx.calculator';
import {
  VwapCalculator,
  createVwapConfig,
} from '../../infrastructure/calculators/vwap/vwap.calculator';
import {
  DonchianCalculator,
  createDonchianConfig,
} from '../../infrastructure/calculators/donchian/donchian.calculator';
import {
  BollingerCalculator,
  createBollingerConfig,
} from '../../infrastructure/calculators/bollinger/bollinger.calculator';
import {
  MacdCalculator,
  createMacdConfig,
} from '../../infrastructure/calculators/macd/macd.calculator';
import {
  SupertrendCalculator,
  createSupertrendConfig,
} from '../../infrastructure/calculators/supertrend/supertrend.calculator';
import {
  VolumeMaCalculator,
  createVolumeMaConfig,
} from '../../infrastructure/calculators/volume-ma/volume-ma.calculator';
import {
  VolumeSpikeCalculator,
  createVolumeSpikeConfig,
} from '../../infrastructure/calculators/volume-spike/volume-spike.calculator';
import {
  TrueRangeCalculator,
  createTrueRangeConfig,
} from '../../infrastructure/calculators/true-range/true-range.calculator';
import {
  HighestHighCalculator,
  createHighestHighConfig,
} from '../../infrastructure/calculators/highest-high/highest-high.calculator';
import {
  LowestLowCalculator,
  createLowestLowConfig,
} from '../../infrastructure/calculators/lowest-low/lowest-low.calculator';

const DEFAULT_TIMEFRAMES: Timeframe[] = [
  Timeframe.ONE_MINUTE,
  Timeframe.FIVE_MINUTES,
  Timeframe.FIFTEEN_MINUTES,
  Timeframe.ONE_HOUR,
];

@Injectable()
export class IndicatorOrchestratorService implements OnModuleInit {
  private readonly context = IndicatorOrchestratorService.name;
  private readonly defaultSymbols: string[];

  constructor(
    private readonly registry: IndicatorRegistryService,
    private readonly warmupService: WarmupService,
    private readonly hashService: RedisHashService,
    private readonly configService: ConfigService,
    private readonly strategyScheduler: StrategySchedulerService,
    private readonly logger: AppLoggerService,
  ) {
    const cfg = this.configService.get<IndicatorConfig>('indicator')!;
    this.defaultSymbols = cfg.defaultSymbols;
  }

  async onModuleInit(): Promise<void> {
    this.registerDefaultIndicators();
    await this.warmup();
  }

  registerDefaultIndicators(): void {
    for (const symbol of this.defaultSymbols) {
      for (const timeframe of DEFAULT_TIMEFRAMES) {
        this.registerIndicatorsForSymbol(symbol, timeframe);
      }
    }
    const status = this.registry.getWarmupStatus();
    this.logger.log(
      `Registered ${status.total} indicators for ${this.defaultSymbols.length} symbol(s)`,
      this.context,
    );
  }

  private registerIndicatorsForSymbol(symbol: string, timeframe: Timeframe): void {
    const calcs = [
      new EmaCalculator(createEmaConfig(symbol, timeframe, 9), this.hashService),
      new EmaCalculator(createEmaConfig(symbol, timeframe, 21), this.hashService),
      new EmaCalculator(createEmaConfig(symbol, timeframe, 50), this.hashService),
      new EmaCalculator(createEmaConfig(symbol, timeframe, 200), this.hashService),
      new SmaCalculator(createSmaConfig(symbol, timeframe, 20), this.hashService),
      new SmaCalculator(createSmaConfig(symbol, timeframe, 50), this.hashService),
      new AtrCalculator(createAtrConfig(symbol, timeframe, 14), this.hashService),
      new AtrCalculator(createAtrConfig(symbol, timeframe, 21), this.hashService),
      new RsiCalculator(createRsiConfig(symbol, timeframe, 14), this.hashService),
      new AdxCalculator(createAdxConfig(symbol, timeframe, 14), this.hashService),
      new VwapCalculator(createVwapConfig(symbol, timeframe), this.hashService),
      new DonchianCalculator(createDonchianConfig(symbol, timeframe, 20), this.hashService),
      new BollingerCalculator(createBollingerConfig(symbol, timeframe, 20), this.hashService),
      new MacdCalculator(createMacdConfig(symbol, timeframe), this.hashService),
      new SupertrendCalculator(createSupertrendConfig(symbol, timeframe), this.hashService),
      new VolumeMaCalculator(createVolumeMaConfig(symbol, timeframe, 20), this.hashService),
      new VolumeSpikeCalculator(createVolumeSpikeConfig(symbol, timeframe, 20), this.hashService),
      new TrueRangeCalculator(createTrueRangeConfig(symbol, timeframe), this.hashService),
      new HighestHighCalculator(createHighestHighConfig(symbol, timeframe, 20), this.hashService),
      new LowestLowCalculator(createLowestLowConfig(symbol, timeframe, 20), this.hashService),
    ];

    for (const calc of calcs) {
      const result = this.registry.register(calc);
      if (result.isErr()) {
        this.logger.warn(`Skipping duplicate indicator: ${calc.id}`, this.context);
      }
    }
  }

  private async warmup(): Promise<void> {
    try {
      await this.warmupService.warmupAll();
      await this.seedStrategyFromWarmup();
    } catch (err) {
      this.logger.error(
        `Warmup failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        this.context,
      );
    }
  }

  /**
   * After indicator warmup, immediately seed all strategies with current indicator
   * values so they show live state (SCANNING / IN_POSITION) from the first request
   * rather than staying in NO_DATA until the next live closed candle arrives.
   *
   * Dispatches the last known closed candle for each symbol+timeframe so strategies
   * set their lastClose / lastHigh / lastVolume, then triggers signal generation once
   * per symbol so indicator snapshots (lastEmaFast, lastAdx, etc.) are populated.
   */
  private async seedStrategyFromWarmup(): Promise<void> {
    const lastCandles = this.warmupService.getLastCandles();
    if (lastCandles.length === 0) {
      this.logger.warn('Post-warmup seed skipped — no historical candles found in Redis', this.context);
      return;
    }

    // Build a single indicator snapshot from all warmed calculators.
    // Note: warmup() applies candles but never calls calculate(), so _latestValue is null.
    // We call calculate() explicitly here to get the current value from each warmed calculator.
    const indicators = new Map<string, IndicatorValue>();
    for (const calc of this.registry.getAll()) {
      const result = calc.calculate();
      if (result.isOk()) indicators.set(calc.id, result.value);
    }

    if (indicators.size === 0) {
      this.logger.warn('Post-warmup seed skipped — no warmed indicator values available', this.context);
      return;
    }

    // Dispatch each candle so every strategy's doOnCandle runs and sets lastClose etc.
    for (const candle of lastCandles) {
      await this.strategyScheduler.dispatchCandle(candle);
    }

    // Trigger signal evaluation once per unique symbol (use the most recent candle per symbol).
    const latestBySymbol = new Map<string, Candle>();
    for (const candle of lastCandles) {
      const existing = latestBySymbol.get(candle.symbol);
      if (!existing || candle.closeTime > existing.closeTime) {
        latestBySymbol.set(candle.symbol, candle);
      }
    }

    for (const [, candle] of latestBySymbol) {
      const context: StrategyContext = {
        exchange: candle.exchange,
        symbol: candle.symbol,
        timestamp: candle.closeTime,
        indicators,
      };
      await this.strategyScheduler.dispatchSignalGeneration(context);
    }

    this.logger.log(
      `Post-warmup strategy seed complete — ${lastCandles.length} candle(s) dispatched, ` +
        `${latestBySymbol.size} symbol(s) evaluated (${indicators.size} indicators)`,
      this.context,
    );
  }

  getRegisteredTypes(): IndicatorType[] {
    return [...new Set(this.registry.getAll().map((c) => c.config.type))];
  }
}
