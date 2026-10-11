import { Result } from '@common/result';
import { MarketTick, Trade } from '@modules/exchange/models/market.models';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { Position } from '@modules/exchange/models/account.models';
import { IndicatorValue } from '@modules/indicator/domain/models/indicator-value.model';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { StrategyState } from '../domain/enums/strategy-state.enum';
import { StrategyConfigValidationError } from '../domain/errors/strategy.errors';
import { Signal } from './signal.interface';

export interface RiskProfile {
  readonly maxPositionSizePercent: number;
  readonly maxDrawdownPercent: number;
  readonly stopLossPercent: number;
  readonly takeProfitPercent: number;
  readonly maxOpenOrders: number;
  readonly leverage?: number;
}

export interface SessionConfig {
  readonly name: string;
  readonly startHourUtc: number;
  readonly endHourUtc: number;
}

export interface ResourceLimits {
  readonly maxCpuMs?: number;
  readonly maxMemoryBytes?: number;
  readonly maxRuntimeMs?: number;
  readonly maxEventsPerSecond?: number;
}

export interface StrategyPluginConfig {
  readonly strategyId: string;
  readonly name: string;
  readonly version: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly riskProfile: RiskProfile;
  readonly enabledSymbols: string[];
  readonly enabledSessions: SessionConfig[];
  readonly resourceLimits: ResourceLimits;
  /**
   * ExchangeId that execution decisions should be routed to.
   * Defaults to the candle's source exchange when not set, which is usually wrong
   * in paper-trading mode (data comes from Binance but orders go to paper_trading).
   * Always set this explicitly so signals reach the correct execution adapter.
   */
  readonly targetExchange?: string;
}

export interface StrategyContext {
  readonly exchange: string;
  readonly symbol: string;
  readonly timestamp: number;
  readonly indicators: ReadonlyMap<string, IndicatorValue>;
  readonly recentTick?: MarketTick;
}

export interface StrategyMetrics {
  readonly signalsGenerated: number;
  readonly averageRuntimeMs: number;
  readonly errorsCount: number;
  readonly skippedEvents: number;
  readonly warmupProgress: number;
}

export interface StrategyHealth {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly state: StrategyState;
  readonly enabled: boolean;
  readonly metrics: StrategyMetrics;
  readonly lastSignalAt: number | null;
  readonly lastErrorAt: number | null;
  readonly lastError: string | null;
}

export interface IStrategy {
  readonly id: string;
  readonly config: StrategyPluginConfig;
  readonly state: StrategyState;
  readonly version: string;

  initialize(): Promise<void>;
  loadConfiguration(config: StrategyPluginConfig): Promise<void>;
  validateConfiguration(config: StrategyPluginConfig): Result<void, StrategyConfigValidationError>;
  warmup(context: StrategyContext): Promise<void>;

  onTick(tick: MarketTick): Promise<void>;
  onTrade(trade: Trade): Promise<void>;
  onCandle(candle: Candle): Promise<void>;
  generateSignal(context: StrategyContext): Promise<Signal | null>;

  onOrderFilled(report: ExecutionReport): Promise<void>;
  onOrderRejected(report: ExecutionReport): Promise<void>;
  onPositionOpened(position: Position): Promise<void>;
  onPositionClosed(position: Position): Promise<void>;

  setEnabled(enabled: boolean): void;
  shutdown(): Promise<void>;

  getHealth(): StrategyHealth;
  getMetrics(): StrategyMetrics;
}
