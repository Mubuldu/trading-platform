export const CONSUMER_GROUPS = {
  INDICATOR_ENGINE: 'indicator-engine',
  STRATEGY_ENGINE: 'strategy-engine',
  RISK_ENGINE: 'risk-engine',
  EXECUTION_ENGINE: 'execution-engine',
  ORDER_MANAGER: 'order-manager',
  ANALYTICS_ENGINE: 'analytics-engine',
  LOGGING_ENGINE: 'logging-engine',
  MONITORING_ENGINE: 'monitoring-engine',
  PAPER_TRADING_ENGINE: 'paper-trading-engine',
  ALERTING_ENGINE: 'alerting-engine',
} as const;

export type ConsumerGroupName = (typeof CONSUMER_GROUPS)[keyof typeof CONSUMER_GROUPS];

export const ALL_CONSUMER_GROUPS: ConsumerGroupName[] = Object.values(CONSUMER_GROUPS);
