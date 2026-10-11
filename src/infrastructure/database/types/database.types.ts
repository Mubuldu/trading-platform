import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

// ── Reusable column patterns ──────────────────────────────────────────────────

type AutoTimestamp = Generated<Date>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;
type AutoVersion = Generated<number>;
type JsonbColumn = ColumnType<unknown, unknown, unknown>;
type Numeric = string; // pg numeric returned as string for precision

// ── accounts ─────────────────────────────────────────────────────────────────

export interface AccountRow {
  id: Generated<string>;
  exchange_id: string;
  account_type: string;
  external_account_id: string | null;
  permissions: JsonbColumn; // string[]
  can_trade: boolean;
  can_withdraw: boolean;
  can_deposit: boolean;
  maker_commission: Numeric | null;
  taker_commission: Numeric | null;
  status: 'active' | 'suspended' | 'closed';
  version: AutoVersion;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── balances ──────────────────────────────────────────────────────────────────

export interface BalanceRow {
  id: Generated<string>;
  account_id: string;
  exchange_id: string;
  asset: string;
  free: Numeric;
  locked: Numeric;
  total: Numeric;
  total_equity: Numeric | null;
  total_unrealized_pnl: Numeric | null;
  total_margin_balance: Numeric | null;
  available_balance: Numeric | null;
  snapshot_at: Date;
  created_at: AutoTimestamp;
}

// ── positions ─────────────────────────────────────────────────────────────────

export interface PositionRow {
  id: Generated<string>;
  account_id: string;
  exchange_id: string;
  symbol: string;
  position_side: string;
  margin_mode: string;
  leverage: number;
  entry_price: Numeric;
  mark_price: Numeric | null;
  quantity: Numeric;
  notional_value: Numeric;
  unrealized_pnl: Numeric;
  realized_pnl: Numeric;
  liquidation_price: Numeric | null;
  margin_used: Numeric;
  maintenance_margin: Numeric;
  position_value: Numeric;
  is_auto_add_margin: boolean;
  status: 'open' | 'closed';
  version: AutoVersion;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── orders ────────────────────────────────────────────────────────────────────

export interface OrderRow {
  id: Generated<string>;
  account_id: string;
  exchange_id: string;
  exchange_order_id: string;
  client_order_id: string | null;
  symbol: string;
  side: string;
  type: string;
  status: string;
  time_in_force: string;
  position_side: string | null;
  original_quantity: Numeric;
  executed_quantity: Numeric;
  remaining_quantity: Numeric;
  cumulative_quote_quantity: Numeric;
  price: Numeric;
  average_price: Numeric;
  stop_price: Numeric | null;
  trailing_delta: number | null;
  reduce_only: boolean;
  post_only: boolean;
  is_iceberg: boolean;
  iceberg_quantity: Numeric | null;
  fee_amount: Numeric | null;
  fee_asset: string | null;
  version: AutoVersion;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── fills ─────────────────────────────────────────────────────────────────────

export interface FillRow {
  id: Generated<string>;
  order_id: string;
  account_id: string;
  exchange_id: string;
  exchange_trade_id: string;
  symbol: string;
  side: string;
  price: Numeric;
  quantity: Numeric;
  quote_quantity: Numeric;
  commission: Numeric | null;
  commission_asset: string | null;
  is_maker: boolean;
  fill_time: Date;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
}

// ── executions ────────────────────────────────────────────────────────────────

export interface ExecutionRow {
  id: Generated<string>;
  order_id: string;
  account_id: string;
  exchange_id: string;
  exchange_order_id: string;
  exchange_trade_id: string | null;
  client_order_id: string | null;
  symbol: string;
  side: string;
  type: string;
  previous_status: string;
  current_status: string;
  position_side: string | null;
  last_executed_quantity: Numeric;
  last_executed_price: Numeric;
  cumulative_filled_quantity: Numeric;
  cumulative_quote_quantity: Numeric;
  commission_amount: Numeric | null;
  commission_asset: string | null;
  is_maker: boolean | null;
  is_liquidation: boolean | null;
  is_reduce_only: boolean | null;
  working_time: Date;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
}

// ── strategies ────────────────────────────────────────────────────────────────

export interface StrategyRow {
  id: Generated<string>;
  name: string;
  description: string | null;
  type: string;
  status: 'active' | 'paused' | 'stopped' | 'error';
  account_id: string;
  exchange_id: string;
  symbols: JsonbColumn; // string[]
  version: AutoVersion;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── strategy_parameters ───────────────────────────────────────────────────────

export interface StrategyParameterRow {
  id: Generated<string>;
  strategy_id: string;
  key: string;
  value: JsonbColumn;
  type: string;
  description: string | null;
  version: AutoVersion;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── risk_profiles ─────────────────────────────────────────────────────────────

export interface RiskProfileRow {
  id: Generated<string>;
  name: string;
  account_id: string;
  strategy_id: string | null;
  max_position_size: Numeric;
  max_daily_loss: Numeric;
  max_drawdown: Numeric;
  max_leverage: number;
  max_open_orders: number;
  allowed_symbols: JsonbColumn; // string[]
  blocked_symbols: JsonbColumn; // string[]
  status: 'active' | 'suspended';
  version: AutoVersion;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── symbols ───────────────────────────────────────────────────────────────────

export interface SymbolRow {
  id: Generated<string>;
  exchange_id: string;
  symbol: string;
  exchange_symbol: string;
  base_asset: string;
  quote_asset: string;
  instrument_type: string;
  status: string;
  base_precision: number;
  quote_precision: number;
  min_quantity: Numeric;
  max_quantity: Numeric;
  step_size: Numeric;
  min_notional: Numeric;
  price_precision: number;
  tick_size: Numeric;
  metadata: JsonbColumn | null;
  version: AutoVersion;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── assets ────────────────────────────────────────────────────────────────────

export interface AssetRow {
  id: Generated<string>;
  symbol: string;
  name: string;
  precision: number;
  is_fiat: boolean;
  is_stable: boolean;
  metadata: JsonbColumn | null;
  version: AutoVersion;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── exchange_metadata ─────────────────────────────────────────────────────────

export interface ExchangeMetadataRow {
  id: Generated<string>;
  exchange_id: string;
  name: string;
  maker_fee: Numeric;
  taker_fee: Numeric;
  rate_limits: JsonbColumn;
  supports_spot: boolean;
  supports_futures: boolean;
  supports_margin: boolean;
  server_time_offset_ms: number;
  status: 'online' | 'maintenance' | 'offline';
  metadata: JsonbColumn | null;
  version: AutoVersion;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── candles ───────────────────────────────────────────────────────────────────

export interface CandleRow {
  id: Generated<string>;
  exchange_id: string;
  symbol: string;
  interval: string;
  open_time: Date;
  close_time: Date;
  open: Numeric;
  high: Numeric;
  low: Numeric;
  close: Numeric;
  volume: Numeric;
  quote_volume: Numeric;
  trade_count: number;
  is_final: boolean;
  created_at: AutoTimestamp;
}

// ── system_logs ───────────────────────────────────────────────────────────────

export interface SystemLogRow {
  id: Generated<string>;
  level: string;
  message: string;
  context: string | null;
  correlation_id: string | null;
  service: string | null;
  metadata: JsonbColumn | null;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
}

// ── audit_logs ────────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: Generated<string>;
  table_name: string;
  record_id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  actor: string | null;
  reason: string | null;
  old_value: JsonbColumn | null;
  new_value: JsonbColumn | null;
  correlation_id: string | null;
  created_at: AutoTimestamp;
}

// ── configuration ─────────────────────────────────────────────────────────────

export interface ConfigurationRow {
  id: Generated<string>;
  namespace: string;
  key: string;
  value: JsonbColumn;
  type: string;
  description: string | null;
  is_secret: boolean;
  version: AutoVersion;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── alerts ────────────────────────────────────────────────────────────────────

export interface AlertRow {
  id: Generated<string>;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'FATAL';
  category: string;
  condition: string;
  title: string;
  message: string;
  source: string;
  fingerprint: string;
  status: 'open' | 'acknowledged' | 'resolved';
  context: JsonbColumn;
  suppressed_count: number;
  escalation_count: number;
  notification_channels: JsonbColumn; // string[]
  notification_sent_at: Date | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  is_recovery: boolean;
  version: AutoVersion;
  deleted_at: Date | null;
  created_at: AutoTimestamp;
  updated_at: UpdatedAt;
}

// ── Kysely Database interface ─────────────────────────────────────────────────

export interface Database {
  accounts: AccountRow;
  balances: BalanceRow;
  positions: PositionRow;
  orders: OrderRow;
  fills: FillRow;
  executions: ExecutionRow;
  strategies: StrategyRow;
  strategy_parameters: StrategyParameterRow;
  risk_profiles: RiskProfileRow;
  symbols: SymbolRow;
  assets: AssetRow;
  exchange_metadata: ExchangeMetadataRow;
  candles: CandleRow;
  system_logs: SystemLogRow;
  audit_logs: AuditLogRow;
  configuration: ConfigurationRow;
  alerts: AlertRow;
}

// ── Selectable / Insertable / Updateable helpers ──────────────────────────────

export type Account = Selectable<AccountRow>;
export type NewAccount = Insertable<AccountRow>;
export type AccountUpdate = Updateable<AccountRow>;

export type Balance = Selectable<BalanceRow>;
export type NewBalance = Insertable<BalanceRow>;

export type Position = Selectable<PositionRow>;
export type NewPosition = Insertable<PositionRow>;
export type PositionUpdate = Updateable<PositionRow>;

export type Order = Selectable<OrderRow>;
export type NewOrder = Insertable<OrderRow>;
export type OrderUpdate = Updateable<OrderRow>;

export type Fill = Selectable<FillRow>;
export type NewFill = Insertable<FillRow>;

export type Execution = Selectable<ExecutionRow>;
export type NewExecution = Insertable<ExecutionRow>;

export type Strategy = Selectable<StrategyRow>;
export type NewStrategy = Insertable<StrategyRow>;
export type StrategyUpdate = Updateable<StrategyRow>;

export type StrategyParameter = Selectable<StrategyParameterRow>;
export type NewStrategyParameter = Insertable<StrategyParameterRow>;
export type StrategyParameterUpdate = Updateable<StrategyParameterRow>;

export type RiskProfile = Selectable<RiskProfileRow>;
export type NewRiskProfile = Insertable<RiskProfileRow>;
export type RiskProfileUpdate = Updateable<RiskProfileRow>;

export type Symbol = Selectable<SymbolRow>;
export type NewSymbol = Insertable<SymbolRow>;
export type SymbolUpdate = Updateable<SymbolRow>;

export type Asset = Selectable<AssetRow>;
export type NewAsset = Insertable<AssetRow>;
export type AssetUpdate = Updateable<AssetRow>;

export type ExchangeMetadata = Selectable<ExchangeMetadataRow>;
export type NewExchangeMetadata = Insertable<ExchangeMetadataRow>;
export type ExchangeMetadataUpdate = Updateable<ExchangeMetadataRow>;

export type Candle = Selectable<CandleRow>;
export type NewCandle = Insertable<CandleRow>;

export type SystemLog = Selectable<SystemLogRow>;
export type NewSystemLog = Insertable<SystemLogRow>;

export type AuditLog = Selectable<AuditLogRow>;
export type NewAuditLog = Insertable<AuditLogRow>;

export type Configuration = Selectable<ConfigurationRow>;
export type NewConfiguration = Insertable<ConfigurationRow>;
export type ConfigurationUpdate = Updateable<ConfigurationRow>;

export type AlertRecord = Selectable<AlertRow>;
export type NewAlertRecord = Insertable<AlertRow>;
export type AlertRecordUpdate = Updateable<AlertRow>;
