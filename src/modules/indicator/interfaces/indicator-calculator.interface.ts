import { Result } from '@common/result';
import { IndicatorType } from '../domain/enums/indicator-type.enum';
import { IndicatorState } from '../domain/enums/indicator-state.enum';
import { Timeframe } from '../domain/enums/timeframe.enum';
import { Candle } from '../domain/models/candle.model';
import { IndicatorValue } from '../domain/models/indicator-value.model';
import {
  IndicatorNotWarmedUpError,
  IndicatorInvalidCandleError,
} from '../domain/errors/indicator.errors';

export interface IndicatorCalculatorConfig {
  readonly type: IndicatorType;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly period: number;
  readonly params: Readonly<Record<string, number>>;
}

export interface IndicatorHealth {
  readonly id: string;
  readonly type: IndicatorType;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly state: IndicatorState;
  readonly candlesProcessed: number;
  readonly warmupRequired: number;
  readonly lastCalculatedAt: number | null;
  readonly lastPublishedAt: number | null;
  readonly lastError: string | null;
  readonly latestValue: IndicatorValue | null;
  readonly historyLength: number;
}

export interface IIndicatorCalculator {
  readonly id: string;
  readonly config: IndicatorCalculatorConfig;
  readonly state: IndicatorState;

  initialize(): void;
  warmup(candles: Candle[]): void;
  update(candle: Candle): Result<void, IndicatorInvalidCandleError>;
  calculate(): Result<IndicatorValue, IndicatorNotWarmedUpError>;
  publish(): Promise<void>;
  reset(): void;
  shutdown(): Promise<void>;

  isWarmedUp(): boolean;
  getWarmupRequired(): number;
  getCandlesProcessed(): number;
  getHealth(): IndicatorHealth;
}
