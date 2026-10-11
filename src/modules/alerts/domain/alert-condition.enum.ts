/**
 * AlertCondition identifies the specific triggering condition for an alert.
 *
 * Conditions ending in *Reconnected / *Recovered / *Resolved are recovery
 * conditions — they clear previously open alerts of the matching type.
 *
 * Never change the string values — they are stored in the database and used
 * to correlate open/recovery pairs for auto-resolution.
 */
export enum AlertCondition {
  // ── Exchange ──────────────────────────────────────────────────────────────
  EXCHANGE_DISCONNECT = 'ExchangeDisconnect',
  EXCHANGE_HIGH_LATENCY = 'ExchangeHighLatency',
  EXCHANGE_RECONNECTED = 'ExchangeReconnected', // recovery

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_FAILURE = 'DatabaseFailure',
  DATABASE_HIGH_LATENCY = 'DatabaseHighLatency',
  DATABASE_POOL_EXHAUSTED = 'DatabasePoolExhausted',
  DATABASE_RECOVERED = 'DatabaseRecovered', // recovery

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_DISCONNECT = 'RedisDisconnect',
  REDIS_HIGH_LATENCY = 'RedisHighLatency',
  REDIS_MEMORY_HIGH = 'RedisMemoryHigh',
  REDIS_RECONNECTED = 'RedisReconnected', // recovery

  // ── Strategy ──────────────────────────────────────────────────────────────
  STRATEGY_ERROR = 'StrategyError',
  STRATEGY_STALLED = 'StrategyStalled',
  STRATEGY_RECOVERED = 'StrategyRecovered', // recovery

  // ── Risk ──────────────────────────────────────────────────────────────────
  DAILY_LOSS_LIMIT = 'DailyLossLimit',
  KILL_SWITCH_ACTIVATED = 'KillSwitchActivated',
  MAX_DRAWDOWN_EXCEEDED = 'MaxDrawdownExceeded',
  POSITION_MISMATCH = 'PositionMismatch',
  RISK_RESOLVED = 'RiskResolved', // recovery

  // ── Execution ─────────────────────────────────────────────────────────────
  ORDER_REJECTED = 'OrderRejected',
  HIGH_ORDER_LATENCY = 'HighOrderLatency',
  EXECUTION_FAILURE = 'ExecutionFailure',
  EXECUTION_RESOLVED = 'ExecutionResolved', // recovery

  // ── Portfolio ─────────────────────────────────────────────────────────────
  PORTFOLIO_SYNC_FAILED = 'PortfolioSyncFailed',
  PORTFOLIO_RECOVERED = 'PortfolioRecovered', // recovery

  // ── Paper Trading ────────────────────────────────────────────────────────────
  PAPER_TRADE_OPENED = 'PaperTradeOpened',
  PAPER_TRADE_CLOSED = 'PaperTradeClosed',

  // ── Infrastructure ────────────────────────────────────────────────────────
  MEMORY_LEAK = 'MemoryLeak',
  CPU_USAGE = 'CpuUsage',
  DISK_USAGE = 'DiskUsage',
  QUEUE_LAG = 'QueueLag',
  CONSUMER_FAILURE = 'ConsumerFailure',
  CONSUMER_RECOVERED = 'ConsumerRecovered', // recovery
  INFRA_RECOVERED = 'InfraRecovered', // recovery
}

/**
 * Recovery conditions that resolve a matching open alert.
 * Maps from recovery condition → the condition it resolves.
 */
export const RECOVERY_CONDITION_MAP: Partial<Record<AlertCondition, AlertCondition>> = {
  [AlertCondition.EXCHANGE_RECONNECTED]: AlertCondition.EXCHANGE_DISCONNECT,
  [AlertCondition.DATABASE_RECOVERED]: AlertCondition.DATABASE_FAILURE,
  [AlertCondition.REDIS_RECONNECTED]: AlertCondition.REDIS_DISCONNECT,
  [AlertCondition.STRATEGY_RECOVERED]: AlertCondition.STRATEGY_ERROR,
  [AlertCondition.RISK_RESOLVED]: AlertCondition.DAILY_LOSS_LIMIT,
  [AlertCondition.EXECUTION_RESOLVED]: AlertCondition.EXECUTION_FAILURE,
  [AlertCondition.PORTFOLIO_RECOVERED]: AlertCondition.PORTFOLIO_SYNC_FAILED,
  [AlertCondition.CONSUMER_RECOVERED]: AlertCondition.CONSUMER_FAILURE,
  [AlertCondition.INFRA_RECOVERED]: AlertCondition.MEMORY_LEAK,
};

/**
 * True when the condition represents a system recovery rather than a failure.
 */
export function isRecoveryCondition(condition: AlertCondition): boolean {
  return condition in RECOVERY_CONDITION_MAP;
}
