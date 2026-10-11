/**
 * SdkContextProviderService — builds SdkStrategyContext and related context objects
 * that are handed to SDK strategies through the PluginSandbox.
 *
 * Responsibilities:
 *   1. Maintain in-memory snapshots of market data (tick, trade, order book) per symbol
 *   2. Maintain execution-report ring buffers per strategy+symbol
 *   3. Build SdkStrategyContext / SdkInitContext / SdkWarmupContext from platform state
 *   4. Enforce permission guards on each SDK interface so strategies without the
 *      required permission receive PermissionDeniedError instead of data
 *
 * This service is stateful but non-async for reads — all context building is
 * synchronous. The IHistoricalDataReader implementation is the one async interface;
 * it is backed by the CandleRepository.
 *
 * Thread safety: all mutation (record* methods) and reads happen in the same Node.js
 * event loop — no concurrent access is possible.
 */

import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_TOKENS } from '@infrastructure/database/database.tokens';
import {
  SdkStrategyContext,
  SdkInitContext,
  SdkWarmupContext,
  IReadonlyMarketData,
  IReadonlyIndicators,
  IReadonlyPortfolio,
  IReadonlyRiskState,
  IHistoricalDataReader,
  IExecutionReportsReader,
  HistoricalDataQuery,
  SdkTick,
  SdkTrade,
  SdkOrderBook,
  SdkCandle,
  SdkIndicatorValue,
  SdkPortfolioSnapshot,
  SdkOpenPosition,
  SdkAssetBalance,
  SdkRiskState,
  SdkExecutionReport,
  StrategyPermission,
  PermissionDeniedError,
} from '@trading-platform/strategy-sdk';
import { RiskConfig } from '@config/risk.config';
import { MarketTick, Trade, OrderBook } from '@modules/exchange/models/market.models';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { IndicatorValue } from '@modules/indicator/domain/models/indicator-value.model';
import { RiskStateService } from '@modules/risk/application/services/risk-state.service';
import { PortfolioManagerService } from '@modules/portfolio/application/services/portfolio-manager.service';
import { ICandleRepository } from '@infrastructure/database/repository/candle.repository';
import { StrategyPluginConfig } from '@modules/strategy/interfaces/strategy.interface';
import {
  toSdkTick,
  toSdkTrade,
  toSdkOrderBook,
  toSdkIndicatorValue,
  toSdkExecutionReport,
  toSdkRiskState,
} from '../adapters/type-adapters';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum execution reports kept per strategy in the in-memory ring buffer. */
const EXECUTION_RING_BUFFER_SIZE = 100;

/** Maximum candles returned from a historical query (platform ceiling). */
const MAX_HISTORICAL_LIMIT = 1_000;

// ── Permission-gated interface implementations ────────────────────────────────

/**
 * PermissionDeniedProxy creates a Proxy that throws PermissionDeniedError for
 * every property access. Used when a strategy accesses an interface it has
 * no permission for.
 */
function permissionDeniedProxy<T extends object>(permissionName: string): T {
  return new Proxy({} as T, {
    get(_target, _prop) {
      return () => {
        throw new PermissionDeniedError(
          'strategy', // strategyId not available at proxy construction time
          permissionName, // the missing permission
        );
      };
    },
  });
}

// ── Concrete interface implementations ────────────────────────────────────────

class ReadonlyMarketDataImpl implements IReadonlyMarketData {
  constructor(
    private readonly ticks: ReadonlyMap<string, SdkTick>,
    private readonly trades: ReadonlyMap<string, SdkTrade>,
    private readonly orderBooks: ReadonlyMap<string, SdkOrderBook>,
  ) {}

  getLatestTick(symbol: string): SdkTick | null {
    return this.ticks.get(symbol) ?? null;
  }

  getLatestTrade(symbol: string): SdkTrade | null {
    return this.trades.get(symbol) ?? null;
  }

  getOrderBook(symbol: string): SdkOrderBook | null {
    return this.orderBooks.get(symbol) ?? null;
  }
}

class ReadonlyIndicatorsImpl implements IReadonlyIndicators {
  /** Lazily converted indicator cache — cached on first get() per key. */
  private readonly converted = new Map<string, SdkIndicatorValue>();
  private _all: ReadonlyMap<string, SdkIndicatorValue> | null = null;

  constructor(private readonly source: ReadonlyMap<string, IndicatorValue>) {}

  get(key: string): SdkIndicatorValue | undefined {
    if (this.converted.has(key)) return this.converted.get(key);

    const raw = this.source.get(key);
    if (!raw) return undefined;

    const sdk = toSdkIndicatorValue(raw);
    if (sdk === null) return undefined; // unrecognised type — forward-compat guard

    this.converted.set(key, sdk);
    return sdk;
  }

  getAll(): ReadonlyMap<string, SdkIndicatorValue> {
    if (this._all) return this._all;

    const map = new Map<string, SdkIndicatorValue>();
    for (const [key, raw] of this.source) {
      const sdk = toSdkIndicatorValue(raw);
      if (sdk !== null) map.set(key, sdk);
    }
    this._all = map;
    return this._all;
  }
}

class ReadonlyPortfolioImpl implements IReadonlyPortfolio {
  constructor(private readonly portfolioManager: PortfolioManagerService) {}

  getSnapshot(): SdkPortfolioSnapshot {
    const state = this.portfolioManager.getState();
    if (!state) {
      // Portfolio manager not yet initialized — return zeroed snapshot
      return {
        equity: 0,
        availableBalance: 0,
        totalExposure: 0,
        currentLeverage: 0,
        openPositions: [],
        unrealizedPnl: 0,
        snapshotAt: Date.now(),
      };
    }

    const openPositions: SdkOpenPosition[] = state.positions
      .filter((p) => p.state !== 'FLAT' && p.quantity > 0)
      .map((p) => ({
        symbol: p.symbol,
        side: p.direction.toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG',
        quantity: p.quantity,
        notionalValue: p.notionalValue,
        unrealizedPnl: p.unrealizedPnl,
        leverage: 1, // PositionSummary does not carry leverage
        entryPrice: p.averageEntryPrice,
        liquidationPrice: null, // Not available in PortfolioStateModel
      }));

    return {
      equity: state.accountEquity,
      availableBalance: state.availableBalance,
      totalExposure: state.totalExposure,
      currentLeverage: state.totalLeverage,
      openPositions,
      unrealizedPnl: state.unrealizedPnl,
      snapshotAt: state.snapshotAt,
    };
  }

  getOpenPositions(): readonly SdkOpenPosition[] {
    return this.getSnapshot().openPositions;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getBalance(_asset: string): SdkAssetBalance | null {
    // PortfolioManagerService does not maintain per-asset balances in its
    // PortfolioStateModel. Returning null is correct per the interface contract:
    // "Returns null when the asset is not held or when balance information is
    // not available for spot accounts that haven't been queried yet."
    // A future extension can inject BalanceRepository here.
    return null;
  }
}

class ReadonlyRiskStateImpl implements IReadonlyRiskState {
  constructor(
    private readonly riskState: RiskStateService,
    private readonly maxDailyLossUsd: number,
  ) {}

  getRiskState(): SdkRiskState {
    const metrics = this.riskState.getMetrics();
    const dailyLoss = this.riskState.getDailyLoss();
    const drawdown = this.riskState.getCurrentDrawdownPercent();
    const remaining = Math.max(0, this.maxDailyLossUsd - dailyLoss);
    const blocked = this.isSignalBlocked();

    let blockedReason: string | null = null;
    if (metrics.isKillSwitchActive) blockedReason = 'Kill switch active';
    else if (metrics.isTradingPaused) blockedReason = 'Trading paused by risk engine';
    else if (metrics.isExposureLocked) blockedReason = 'Exposure locked';

    return toSdkRiskState(
      drawdown,
      dailyLoss,
      remaining,
      this.portfolioOpenPositionCount(),
      blocked ? blockedReason : null,
    );
  }

  isSignalBlocked(): boolean {
    return (
      this.riskState.isKillSwitchActive() ||
      this.riskState.isTradingPaused() ||
      this.riskState.isExposureLocked()
    );
  }

  getRemainingDailyLossUsd(): number {
    if (this.maxDailyLossUsd <= 0) return Infinity;
    return Math.max(0, this.maxDailyLossUsd - this.riskState.getDailyLoss());
  }

  /**
   * Best-effort open position count derived from getRiskState().
   * A real implementation would have a direct portfolio reference.
   */
  private portfolioOpenPositionCount(): number {
    // This value is not directly available on RiskStateService.
    // We return 0 as a safe default; the SdkContextProviderService
    // may override this when building the context with portfolio data.
    return 0;
  }
}

class HistoricalDataReaderImpl implements IHistoricalDataReader {
  constructor(
    private readonly candleRepo: ICandleRepository,
    private readonly exchange: string,
  ) {}

  async getCandles(query: HistoricalDataQuery): Promise<readonly SdkCandle[]> {
    const limit = Math.min(query.limit, MAX_HISTORICAL_LIMIT);
    const interval = query.timeframe; // SdkTimeframe matches platform interval strings

    const result = await this.candleRepo.findLatest(this.exchange, query.symbol, interval, limit);
    if (result.isErr()) {
      throw new Error(`Failed to load historical candles: ${result.error.message}`);
    }

    const dbCandles = result.value;

    // Apply endTime filter if specified
    const filtered = query.endTime
      ? dbCandles.filter((c) => {
          const closeTime =
            c.close_time instanceof Date ? c.close_time.getTime() : Number(c.close_time);
          return closeTime <= query.endTime!;
        })
      : dbCandles;

    return filtered.map((c): SdkCandle => ({
      symbol: c.symbol,
      exchange: c.exchange_id,
      timeframe: c.interval as SdkCandle['timeframe'],
      openTime: c.open_time instanceof Date ? c.open_time.getTime() : Number(c.open_time),
      closeTime: c.close_time instanceof Date ? c.close_time.getTime() : Number(c.close_time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
      isClosed: c.is_final,
    }));
  }
}

class ExecutionReportsReaderImpl implements IExecutionReportsReader {
  constructor(private readonly buffer: readonly SdkExecutionReport[]) {}

  getRecentFills(symbol: string, limit = 10): readonly SdkExecutionReport[] {
    const cap = Math.min(limit, EXECUTION_RING_BUFFER_SIZE);
    return this.buffer.filter((r) => r.symbol === symbol).slice(0, cap);
  }

  getLastFill(symbol: string): SdkExecutionReport | null {
    return this.buffer.find((r) => r.symbol === symbol) ?? null;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class SdkContextProviderService {
  private readonly maxDailyLossUsd: number;

  /** Most recent tick snapshot per symbol. */
  private readonly tickSnapshots = new Map<string, SdkTick>();

  /** Most recent trade snapshot per symbol. */
  private readonly tradeSnapshots = new Map<string, SdkTrade>();

  /** Most recent order book snapshot per symbol. */
  private readonly orderBookSnapshots = new Map<string, SdkOrderBook>();

  /**
   * Execution report ring buffers keyed by strategyId.
   * Each buffer stores at most EXECUTION_RING_BUFFER_SIZE entries, newest first.
   */
  private readonly executionBuffers = new Map<string, SdkExecutionReport[]>();

  constructor(
    configService: ConfigService,
    private readonly riskState: RiskStateService,
    private readonly portfolioManager: PortfolioManagerService,
    @Inject(DATABASE_TOKENS.CANDLE_REPOSITORY)
    private readonly candleRepo: ICandleRepository,
  ) {
    const cfg = configService.get<RiskConfig>('risk')!;
    this.maxDailyLossUsd = cfg.maxDailyLossUsd;
  }

  // ── Market data event intake ─────────────────────────────────────────────────

  /** Called by the market data adapter on every new tick. */
  recordTick(tick: MarketTick): void {
    this.tickSnapshots.set(tick.symbol, toSdkTick(tick));
  }

  /** Called by the market data adapter on every new trade. */
  recordTrade(trade: Trade): void {
    this.tradeSnapshots.set(trade.symbol, toSdkTrade(trade));
  }

  /** Called by the market data adapter on every order book update. */
  recordOrderBook(book: OrderBook): void {
    this.orderBookSnapshots.set(book.symbol, toSdkOrderBook(book));
  }

  // ── Execution report intake ──────────────────────────────────────────────────

  /**
   * Called by SdkStrategyAdapter when onOrderFilled or onOrderRejected fires.
   * Prepends to the strategy's ring buffer, trimming to EXECUTION_RING_BUFFER_SIZE.
   */
  recordExecution(report: ExecutionReport, strategyId: string): void {
    const sdkReport = toSdkExecutionReport(report, strategyId);
    let buffer = this.executionBuffers.get(strategyId);
    if (!buffer) {
      buffer = [];
      this.executionBuffers.set(strategyId, buffer);
    }
    buffer.unshift(sdkReport);
    if (buffer.length > EXECUTION_RING_BUFFER_SIZE) {
      buffer.length = EXECUTION_RING_BUFFER_SIZE;
    }
  }

  // ── Context builders ─────────────────────────────────────────────────────────

  /**
   * Builds SdkInitContext for onInitialize().
   *
   * Contains strategy identity only — no market data or risk state needed at init.
   */
  buildSdkInitContext(config: StrategyPluginConfig): SdkInitContext {
    return {
      strategyId: config.strategyId,
      symbol: config.enabledSymbols[0] ?? '',
      exchange: '', // exchange identity is not carried in StrategyPluginConfig
      parameters: config.parameters,
    };
  }

  /**
   * Builds SdkWarmupContext for onWarmup().
   *
   * Adds IHistoricalDataReader to the init context so the strategy can
   * load historical candles during warmup.
   */
  buildSdkWarmupContext(config: StrategyPluginConfig, exchangeId: string): SdkWarmupContext {
    return {
      strategyId: config.strategyId,
      symbol: config.enabledSymbols[0] ?? '',
      exchange: exchangeId,
      parameters: config.parameters,
      historical: new HistoricalDataReaderImpl(this.candleRepo, exchangeId),
    };
  }

  /**
   * Builds SdkStrategyContext for generateSignal().
   *
   * Maps the platform's StrategyContext onto the SDK's read-only context
   * interfaces, gating each interface behind the strategy's declared permissions.
   *
   * @param platformCtx   Platform strategy context (indicators, timestamp, tick)
   * @param strategyId    ID of the strategy receiving the context
   * @param exchangeId    Exchange the strategy is running on
   * @param permissions   Set of permissions declared in the strategy manifest
   */
  buildSdkStrategyContext(
    platformCtx: {
      readonly exchange: string;
      readonly symbol: string;
      readonly timestamp: number;
      readonly indicators: ReadonlyMap<string, IndicatorValue>;
      readonly recentTick?: MarketTick;
    },
    strategyId: string,
    exchangeId: string,
    permissions: ReadonlySet<StrategyPermission>,
  ): SdkStrategyContext {
    // Update tick snapshot if the platform context carries a more recent one
    if (platformCtx.recentTick) {
      this.recordTick(platformCtx.recentTick);
    }

    const hasPermission = (p: StrategyPermission): boolean => permissions.has(p);

    const marketData: IReadonlyMarketData = hasPermission(StrategyPermission.READ_MARKET_DATA)
      ? new ReadonlyMarketDataImpl(this.tickSnapshots, this.tradeSnapshots, this.orderBookSnapshots)
      : permissionDeniedProxy<IReadonlyMarketData>(StrategyPermission.READ_MARKET_DATA);

    const indicators: IReadonlyIndicators = hasPermission(StrategyPermission.READ_INDICATORS)
      ? new ReadonlyIndicatorsImpl(platformCtx.indicators)
      : permissionDeniedProxy<IReadonlyIndicators>(StrategyPermission.READ_INDICATORS);

    const portfolio: IReadonlyPortfolio = hasPermission(StrategyPermission.READ_PORTFOLIO)
      ? new ReadonlyPortfolioImpl(this.portfolioManager)
      : permissionDeniedProxy<IReadonlyPortfolio>(StrategyPermission.READ_PORTFOLIO);

    const riskState: IReadonlyRiskState = hasPermission(StrategyPermission.READ_RISK_STATE)
      ? new ReadonlyRiskStateImpl(this.riskState, this.maxDailyLossUsd)
      : permissionDeniedProxy<IReadonlyRiskState>(StrategyPermission.READ_RISK_STATE);

    const historical: IHistoricalDataReader = hasPermission(StrategyPermission.READ_HISTORICAL_DATA)
      ? new HistoricalDataReaderImpl(this.candleRepo, exchangeId)
      : permissionDeniedProxy<IHistoricalDataReader>(StrategyPermission.READ_HISTORICAL_DATA);

    const executionReports: IExecutionReportsReader = hasPermission(
      StrategyPermission.READ_EXECUTION_REPORTS,
    )
      ? new ExecutionReportsReaderImpl(this.executionBuffers.get(strategyId) ?? [])
      : permissionDeniedProxy<IExecutionReportsReader>(StrategyPermission.READ_EXECUTION_REPORTS);

    return {
      symbol: platformCtx.symbol,
      exchange: exchangeId,
      timestamp: platformCtx.timestamp,
      marketData,
      indicators,
      portfolio,
      riskState,
      historical,
      executionReports,
    };
  }
}
