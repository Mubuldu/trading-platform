import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { DataSourceType } from '../enums/data-source-type.enum';

export interface BacktestStrategyEntry {
  readonly strategyType: string;
  readonly config: import('@modules/strategy/interfaces/strategy.interface').StrategyPluginConfig;
}

export interface BacktestCommissionConfig {
  readonly makerBps: number;
  readonly takerBps: number;
}

export interface BacktestSlippageConfig {
  readonly fixedBps: number;
  readonly volumeParticipationRate: number;
  readonly maxSlippageBps: number;
}

/**
 * Extra indicator periods required by a specific strategy configuration that are
 * not covered by the factory's default set (EMA-9/21/50/200, ATR-14/21, ADX-14,
 * Donchian-20, VolumeMa-20).
 *
 * The parameter optimizer uses this to inject the exact periods it needs for each
 * search-space combo so the strategy's indicator lookups don't miss.
 */
export interface ExtraIndicatorPeriods {
  readonly ema?: ReadonlyArray<number>;
  readonly atr?: ReadonlyArray<number>;
  readonly adx?: ReadonlyArray<number>;
  readonly donchian?: ReadonlyArray<number>;
  readonly volumeMa?: ReadonlyArray<number>;
}

export interface BacktestConfig {
  readonly sessionId: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly timeframe: Timeframe;

  readonly startTime: number;
  readonly endTime: number;

  readonly warmupCandles: number;

  readonly initialCapitalUsd: number;
  readonly commission: BacktestCommissionConfig;
  readonly slippage: BacktestSlippageConfig;

  readonly dataSource: DataSourceType;
  readonly csvFilePath?: string;

  readonly strategies: BacktestStrategyEntry[];

  readonly enableRiskChecks: boolean;
  readonly maxPositionSizePercent: number;
  readonly maxDailyLossPercent: number;

  readonly fillOnClose: boolean;

  /**
   * Extra indicator periods to create in addition to the factory defaults.
   * Set by the parameter optimizer so each combo's strategy params map to
   * a real calculator in the indicator context.
   */
  readonly extraIndicatorPeriods?: ExtraIndicatorPeriods;
}
