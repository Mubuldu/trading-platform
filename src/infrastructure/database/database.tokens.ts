export const DATABASE_TOKENS = {
  // Repositories
  ACCOUNT_REPOSITORY: Symbol('AccountRepository'),
  BALANCE_REPOSITORY: Symbol('BalanceRepository'),
  POSITION_REPOSITORY: Symbol('PositionRepository'),
  ORDER_REPOSITORY: Symbol('OrderRepository'),
  FILL_REPOSITORY: Symbol('FillRepository'),
  EXECUTION_REPOSITORY: Symbol('ExecutionRepository'),
  STRATEGY_REPOSITORY: Symbol('StrategyRepository'),
  STRATEGY_PARAMETER_REPOSITORY: Symbol('StrategyParameterRepository'),
  RISK_PROFILE_REPOSITORY: Symbol('RiskProfileRepository'),
  SYMBOL_REPOSITORY: Symbol('SymbolRepository'),
  ASSET_REPOSITORY: Symbol('AssetRepository'),
  EXCHANGE_METADATA_REPOSITORY: Symbol('ExchangeMetadataRepository'),
  CANDLE_REPOSITORY: Symbol('CandleRepository'),
  SYSTEM_LOG_REPOSITORY: Symbol('SystemLogRepository'),
  AUDIT_LOG_REPOSITORY: Symbol('AuditLogRepository'),
  CONFIGURATION_REPOSITORY: Symbol('ConfigurationRepository'),
} as const;
