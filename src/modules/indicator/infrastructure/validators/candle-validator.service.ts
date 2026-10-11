import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Result, ok, err } from '@common/result';
import { IndicatorConfig } from '@config/indicator.config';
import { Candle } from '../../domain/models/candle.model';
import { IndicatorInvalidCandleError } from '../../domain/errors/indicator.errors';
import {
  VALID_CANDLE_SPECIFICATION,
  CandleIsNotInFutureSpecification,
} from '../../domain/specifications/candle-valid.specification';

interface ValidationContext {
  lastTimestamp: number;
  seenTimestamps: Set<number>;
}

@Injectable()
export class CandleValidatorService {
  private readonly maxFutureSkewMs: number;
  private readonly futureSpec: CandleIsNotInFutureSpecification;
  private readonly contexts = new Map<string, ValidationContext>();

  constructor(private readonly configService: ConfigService) {
    this.maxFutureSkewMs =
      this.configService.get<IndicatorConfig>('indicator')!.maxFutureTimestampSkewMs;
    this.futureSpec = new CandleIsNotInFutureSpecification(this.maxFutureSkewMs);
  }

  validate(candle: Candle): Result<Candle, IndicatorInvalidCandleError> {
    if (!VALID_CANDLE_SPECIFICATION.isSatisfiedBy(candle)) {
      return err(
        new IndicatorInvalidCandleError(
          `OHLC values invalid — open=${candle.open} high=${candle.high} low=${candle.low} close=${candle.close}`,
          { symbol: candle.symbol, timeframe: candle.timeframe, openTime: candle.openTime },
        ),
      );
    }

    if (!this.futureSpec.isSatisfiedBy(candle)) {
      return err(
        new IndicatorInvalidCandleError(
          `Candle timestamp is too far in the future: openTime=${candle.openTime}, now=${Date.now()}`,
          { openTime: candle.openTime, skewMs: candle.openTime - Date.now() },
        ),
      );
    }

    const ctx = this.getOrCreateContext(candle.symbol, candle.timeframe);

    if (ctx.seenTimestamps.has(candle.openTime)) {
      return err(
        new IndicatorInvalidCandleError(`Duplicate candle at openTime=${candle.openTime}`, {
          symbol: candle.symbol,
          timeframe: candle.timeframe,
          openTime: candle.openTime,
        }),
      );
    }

    if (ctx.lastTimestamp > 0 && candle.openTime < ctx.lastTimestamp) {
      return err(
        new IndicatorInvalidCandleError(
          `Out-of-order candle: openTime=${candle.openTime} < lastTimestamp=${ctx.lastTimestamp}`,
          { openTime: candle.openTime, lastTimestamp: ctx.lastTimestamp },
        ),
      );
    }

    ctx.seenTimestamps.add(candle.openTime);
    if (ctx.seenTimestamps.size > 2000) {
      const oldest = [...ctx.seenTimestamps].slice(0, 1000);
      for (const ts of oldest) ctx.seenTimestamps.delete(ts);
    }
    ctx.lastTimestamp = candle.openTime;

    return ok(candle);
  }

  resetContext(symbol: string, timeframe: string): void {
    this.contexts.delete(`${symbol}:${timeframe}`);
  }

  private getOrCreateContext(symbol: string, timeframe: string): ValidationContext {
    const key = `${symbol}:${timeframe}`;
    if (!this.contexts.has(key)) {
      this.contexts.set(key, { lastTimestamp: 0, seenTimestamps: new Set() });
    }
    return this.contexts.get(key)!;
  }
}
