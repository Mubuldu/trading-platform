import { Result } from '@common/result';
import { Timeframe } from '../domain/enums/timeframe.enum';
import {
  IndicatorAlreadyRegisteredError,
  IndicatorNotFoundError,
} from '../domain/errors/indicator.errors';
import { IIndicatorCalculator, IndicatorHealth } from './indicator-calculator.interface';

export interface WarmupStatus {
  readonly total: number;
  readonly warmedUp: number;
  readonly allWarmedUp: boolean;
  readonly pending: string[];
}

export interface IndicatorRegistryHealth {
  readonly totalRegistered: number;
  readonly warmedUp: number;
  readonly inError: number;
  readonly byType: Record<string, number>;
  readonly indicators: IndicatorHealth[];
}

export interface IIndicatorRegistry {
  register(calculator: IIndicatorCalculator): Result<void, IndicatorAlreadyRegisteredError>;
  remove(id: string): Result<void, IndicatorNotFoundError>;
  get(id: string): Result<IIndicatorCalculator, IndicatorNotFoundError>;
  getAll(): IIndicatorCalculator[];
  getBySymbolAndTimeframe(symbol: string, timeframe: Timeframe): IIndicatorCalculator[];
  getWarmupStatus(): WarmupStatus;
  getHealth(): IndicatorRegistryHealth;
}
