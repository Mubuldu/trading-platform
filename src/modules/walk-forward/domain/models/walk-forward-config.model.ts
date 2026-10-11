import { BacktestConfig } from '@modules/backtest/domain/models/backtest-config.model';
import { StrategyPluginConfig } from '@modules/strategy/interfaces/strategy.interface';
import { OptimizationMetric } from '../enums/optimization-metric.enum';
import { WindowType } from '../enums/window-type.enum';

export type ParameterGrid = Record<string, number[]>;

export type BaseBacktestConfig = Omit<
  BacktestConfig,
  'sessionId' | 'startTime' | 'endTime' | 'strategies'
>;

export interface WalkForwardConfig {
  readonly runId: string;

  readonly startTime: number;
  readonly endTime: number;

  readonly baseBacktestConfig: BaseBacktestConfig;

  readonly strategyType: string;
  readonly baseStrategyConfig: StrategyPluginConfig;

  readonly windowType: WindowType;
  readonly trainWindowMs: number;
  readonly testWindowMs: number;
  readonly stepMs?: number;

  readonly parameterGrid: ParameterGrid;
  readonly optimizationMetric: OptimizationMetric;
  readonly minTradesRequired: number;

  readonly maxDrawdownFilterPercent?: number;
}
