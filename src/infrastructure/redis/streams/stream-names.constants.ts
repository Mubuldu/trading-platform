export const STREAM_NAMES = {
  // Market data streams
  MARKET_TICK: 'market:tick',
  MARKET_TRADE: 'market:trade',
  MARKET_KLINE_1M: 'market:kline:1m',
  MARKET_KLINE_5M: 'market:kline:5m',
  MARKET_KLINE_15M: 'market:kline:15m',
  MARKET_KLINE_1H: 'market:kline:1h',
  MARKET_ORDERBOOK: 'market:orderbook',
  MARKET_FUNDING: 'market:funding',
  MARKET_LIQUIDATION: 'market:liquidation',

  // Strategy streams
  STRATEGY_SIGNAL: 'strategy:signal',

  // Risk streams
  RISK_DECISION: 'risk:decision',

  // Execution streams
  EXECUTION_REQUEST: 'execution:request',
  EXECUTION_REPORT: 'execution:report',
  EXECUTION_AUDIT: 'execution:audit',
  ORDER_UPDATE: 'order:update',

  // Portfolio streams
  POSITION_UPDATE: 'position:update',
  PORTFOLIO_UPDATE: 'portfolio:update',
  PORTFOLIO_METRICS: 'portfolio:metrics',
  PORTFOLIO_RISK: 'portfolio:risk',
  RISK_UPDATE: 'risk:update',

  // Paper trading streams (fully isolated — never mixed with live streams)
  PAPER_EXECUTION_REPORT: 'paper:execution:report',
  PAPER_POSITION_UPDATE: 'paper:position:update',
  PAPER_PORTFOLIO_UPDATE: 'paper:portfolio:update',
  PAPER_PORTFOLIO_METRICS: 'paper:portfolio:metrics',

  // System streams
  SYSTEM_EVENT: 'system:event',
  SYSTEM_ERROR: 'system:error',
  AUDIT_EVENT: 'audit:event',

  // Reconciliation
  RECONCILIATION_ALERT: 'reconciliation:alert',

  // Alerting
  ALERT_EVENT: 'alert:event',

  // Dead letter queue
  DEAD_LETTER: 'system:dead-letter',
} as const;

export type StreamName = (typeof STREAM_NAMES)[keyof typeof STREAM_NAMES];

export const ALL_STREAMS: StreamName[] = Object.values(STREAM_NAMES);

export const MARKET_STREAMS: StreamName[] = [
  STREAM_NAMES.MARKET_TICK,
  STREAM_NAMES.MARKET_TRADE,
  STREAM_NAMES.MARKET_KLINE_1M,
  STREAM_NAMES.MARKET_KLINE_5M,
  STREAM_NAMES.MARKET_KLINE_15M,
  STREAM_NAMES.MARKET_KLINE_1H,
  STREAM_NAMES.MARKET_ORDERBOOK,
  STREAM_NAMES.MARKET_FUNDING,
  STREAM_NAMES.MARKET_LIQUIDATION,
];
