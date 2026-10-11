import { Result } from '@common/result';
import {
  StrategyAlreadyRegisteredError,
  StrategyError,
  StrategyNotFoundError,
} from '../domain/errors/strategy.errors';
import { IStrategy, StrategyHealth, StrategyPluginConfig } from './strategy.interface';

export interface StrategyRegistryHealth {
  readonly totalRegistered: number;
  readonly enabled: number;
  readonly inError: number;
  readonly byState: Record<string, number>;
  readonly strategies: StrategyHealth[];
}

export interface IStrategyRegistry {
  register(strategy: IStrategy): Result<void, StrategyAlreadyRegisteredError>;
  unregister(id: string): Result<void, StrategyNotFoundError>;
  enable(id: string): Result<void, StrategyNotFoundError>;
  disable(id: string): Result<void, StrategyNotFoundError>;
  reload(id: string, newConfig: StrategyPluginConfig): Promise<Result<void, StrategyError>>;
  get(id: string): Result<IStrategy, StrategyNotFoundError>;
  getAll(): IStrategy[];
  getEnabled(): IStrategy[];
  getVersion(id: string): Result<string, StrategyNotFoundError>;
  getHealth(): StrategyRegistryHealth;
}
