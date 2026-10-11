/**
 * StrategyPermission is the complete set of platform APIs a strategy may declare access to.
 *
 * Permissions are declared in the PluginManifest. The platform enforces them at plugin
 * install time (validation) and at runtime (the SdkStrategyContext only exposes APIs
 * matching the declared permissions — undeclared APIs throw PermissionDeniedError).
 *
 * Security model — no strategy may ever:
 *   - Submit, cancel, or modify orders directly
 *   - Read or write the database
 *   - Read or write Redis
 *   - Access the file system
 *   - Read environment variables
 *   - Open network connections
 *   - Import infrastructure modules
 *
 * These restrictions are architectural: strategies are pure computation units.
 * They receive data and return signals — all side-effects belong to the platform.
 *
 * Permission precedence: the platform applies the more conservative of the platform-wide
 * limit and the per-strategy limit configured in the manifest's riskLimits field.
 */
export enum StrategyPermission {
  /**
   * Real-time market data: best bid/ask ticks, trade feed, order book snapshots.
   * Enables: ctx.marketData, onTick(), onTrade() hooks.
   */
  READ_MARKET_DATA = 'READ_MARKET_DATA',

  /**
   * Computed indicator values: EMA, SMA, ATR, RSI, ADX, MACD, Bollinger, etc.
   * Enables: ctx.indicators.
   * Without this permission, ctx.indicators returns an empty map.
   */
  READ_INDICATORS = 'READ_INDICATORS',

  /**
   * Portfolio state: asset balances, equity, available margin, exposure summary.
   * Enables: ctx.portfolio.
   */
  READ_PORTFOLIO = 'READ_PORTFOLIO',

  /**
   * Risk engine state: current drawdown, daily loss limits, signal block status.
   * Enables: ctx.riskState.
   */
  READ_RISK_STATE = 'READ_RISK_STATE',

  /**
   * Signal emission permission — ALWAYS required.
   * A plugin that omits GENERATE_SIGNALS is rejected at validation time.
   * Without this permission the strategy exists but is a no-op.
   */
  GENERATE_SIGNALS = 'GENERATE_SIGNALS',

  /**
   * Historical OHLCV candle data for warmup and context loading.
   * Enables: ctx.historical.getCandles(), onWarmup() receives a fully-populated ctx.
   */
  READ_HISTORICAL_DATA = 'READ_HISTORICAL_DATA',

  /**
   * Current open positions across all strategy instances.
   * Enables: ctx.portfolio.getOpenPositions().
   * Implied by READ_PORTFOLIO; declaring both is redundant but harmless.
   */
  READ_POSITIONS = 'READ_POSITIONS',

  /**
   * Execution reports: recent fills, rejections, order lifecycle events.
   * Enables: ctx.executionReports, onOrderFilled(), onOrderRejected() hooks.
   */
  READ_EXECUTION_REPORTS = 'READ_EXECUTION_REPORTS',
}
