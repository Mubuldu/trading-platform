import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  StreamConsumerService,
  ConsumerSubscription,
} from '@infrastructure/redis/streams/stream-consumer.service';
import { ConsumerManagerService } from '@infrastructure/redis/streams/consumer-manager.service';
import { ConsumedMessage } from '@infrastructure/redis/streams/stream-event.interface';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { CONSUMER_GROUPS } from '@infrastructure/redis/streams/consumer-groups.constants';
import { StrategySchedulerService } from '@modules/strategy/scheduler/strategy-scheduler.service';
import { StrategyContext } from '@modules/strategy/interfaces/strategy.interface';
import { IndicatorValue } from '../../domain/models/indicator-value.model';
import { Candle } from '../../domain/models/candle.model';
import { Timeframe } from '../../domain/enums/timeframe.enum';
import { IndicatorRegistryService } from '../registry/indicator-registry.service';
import { CandleValidatorService } from '../validators/candle-validator.service';

type KlinePayload = {
  openTime: number;
  closeTime: number;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  isClosed: boolean;
};

const KLINE_STREAMS: Array<{
  stream: (typeof STREAM_NAMES)[keyof typeof STREAM_NAMES];
  timeframe: Timeframe;
}> = [
  { stream: STREAM_NAMES.MARKET_KLINE_1M, timeframe: Timeframe.ONE_MINUTE },
  { stream: STREAM_NAMES.MARKET_KLINE_5M, timeframe: Timeframe.FIVE_MINUTES },
  { stream: STREAM_NAMES.MARKET_KLINE_15M, timeframe: Timeframe.FIFTEEN_MINUTES },
  { stream: STREAM_NAMES.MARKET_KLINE_1H, timeframe: Timeframe.ONE_HOUR },
];

@Injectable()
export class KlineConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly context = KlineConsumerService.name;
  private readonly subscriptions: ConsumerSubscription[] = [];

  constructor(
    private readonly consumerManager: ConsumerManagerService,
    private readonly streamConsumer: StreamConsumerService,
    private readonly registry: IndicatorRegistryService,
    private readonly validator: CandleValidatorService,
    private readonly strategyScheduler: StrategySchedulerService,
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const { stream, timeframe } of KLINE_STREAMS) {
      await this.consumerManager.registerGroup({
        streamName: stream,
        groupName: CONSUMER_GROUPS.INDICATOR_ENGINE,
        startId: '0',
      });

      const sub = this.streamConsumer.subscribe(stream, CONSUMER_GROUPS.INDICATOR_ENGINE, (msg) =>
        this.handleMessage(msg, timeframe),
      );
      this.subscriptions.push(sub);
      this.logger.log(`Subscribed to ${stream}`, this.context);
    }
  }

  onModuleDestroy(): void {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
    this.subscriptions.length = 0;
  }

  private async handleMessage(message: ConsumedMessage, timeframe: Timeframe): Promise<void> {
    const { event } = message;
    const payload = event.payload as KlinePayload;

    // Binance sends an update for every tick inside a live candle — same openTime,
    // changing OHLCV values. Only the final message has isClosed=true.
    // Intermediate updates must be dropped here for two reasons:
    //   1. CandleValidatorService rejects any candle whose openTime it has already
    //      seen, so the second update (and every subsequent one, including the actual
    //      closed candle) would be silently discarded as a "duplicate".
    //   2. Calling calc.update() on every intermediate tick applies the EMA formula
    //      multiple times per period, producing wildly wrong indicator values.
    if (!payload.isClosed) return;

    // Upgrade to INFO so closed-candle arrival is always visible in the server log.
    this.logger.log(
      `[LIVE CLOSE] received ${event.symbol}/${timeframe} openTime=${payload.openTime} close=${payload.close}`,
      this.context,
    );

    const candle: Candle = {
      symbol: event.symbol,
      exchange: event.exchange,
      timeframe,
      openTime: Number(payload.openTime),
      closeTime: Number(payload.closeTime),
      open: Number(payload.open),
      high: Number(payload.high),
      low: Number(payload.low),
      close: Number(payload.close),
      volume: Number(payload.volume),
      isClosed: true,
    };

    const validationResult = this.validator.validate(candle);
    if (validationResult.isErr()) {
      this.logger.warn(
        `[LIVE CLOSE] validation failed for ${candle.symbol}/${candle.timeframe}: ${validationResult.error.message}`,
        this.context,
      );
      return;
    }

    const calculators = this.registry.getBySymbolAndTimeframe(candle.symbol, candle.timeframe);
    if (calculators.length === 0) {
      this.logger.warn(
        `[LIVE CLOSE] no calculators found for ${candle.symbol}/${candle.timeframe}`,
        this.context,
      );
      return;
    }

    this.logger.log(
      `[LIVE CLOSE] updating ${calculators.length} calculators for ${candle.symbol}/${candle.timeframe} ` +
        `close=${candle.close} vol=${candle.volume.toFixed(2)}`,
      this.context,
    );

    await Promise.all(
      calculators.map(async (calc) => {
        const updateResult = calc.update(candle);
        if (updateResult.isErr()) {
          this.logger.warn(
            `Calculator ${calc.id} rejected candle: ${updateResult.error.message}`,
            this.context,
          );
          return;
        }
        await calc.publish();
      }),
    );

    // Dispatch closed candles to strategy framework so strategies can update
    // internal state and evaluate signals against fresh indicator values.
    if (candle.isClosed) {
      // 1. Let strategies update per-candle internal state (doOnCandle).
      await this.strategyScheduler.dispatchCandle(candle);

      // 2. Build a snapshot of every indicator's latest value.
      //    Calculators are in-process objects; the snapshot is synchronous and cheap.
      const indicators = new Map<string, IndicatorValue>();
      for (const calc of this.registry.getAll()) {
        const latest = calc.getHealth().latestValue;
        if (latest !== null) {
          indicators.set(calc.id, latest);
        }
      }

      // 3. Trigger signal evaluation on all enabled strategies.
      const context: StrategyContext = {
        exchange: candle.exchange,
        symbol: candle.symbol,
        timestamp: candle.closeTime,
        indicators,
      };
      this.logger.log(
        `[LIVE CLOSE] dispatching signal generation for ${candle.symbol}/${candle.timeframe} ` +
          `with ${indicators.size} indicator(s)`,
        this.context,
      );
      await this.strategyScheduler.dispatchSignalGeneration(context);
    }
  }
}
