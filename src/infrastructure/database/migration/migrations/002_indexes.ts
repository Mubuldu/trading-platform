import { Kysely, sql } from 'kysely';

/**
 * Production indexes optimized for:
 * - Position lookup: account + symbol + status
 * - Order lookup: exchange_order_id, client_order_id, symbol, status
 * - Trade history: account + symbol + created_at (time-range scans)
 * - Time series: candles by symbol + interval + open_time
 * - Strategy queries: account + status
 * - Soft-delete: partial indexes excluding deleted rows where beneficial
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── accounts ───────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_accounts_exchange_id ON accounts (exchange_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status) WHERE deleted_at IS NULL`.execute(
    db,
  );

  // ── balances ───────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_balances_account_id ON balances (account_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_balances_account_asset ON balances (account_id, asset)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_balances_snapshot_at ON balances (snapshot_at DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_balances_account_snapshot ON balances (account_id, snapshot_at DESC)`.execute(
    db,
  );

  // ── positions ──────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_positions_account_id ON positions (account_id) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_positions_account_symbol ON positions (account_id, symbol) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_positions_symbol_status ON positions (symbol, status) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_positions_exchange ON positions (exchange_id, symbol) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_positions_open ON positions (account_id, status) WHERE status = 'open' AND deleted_at IS NULL`.execute(
    db,
  );

  // ── orders ─────────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_account_id ON orders (account_id) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_exchange_order_id ON orders (exchange_id, exchange_order_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders (client_order_id) WHERE client_order_id IS NOT NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders (symbol, status) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_account_symbol ON orders (account_id, symbol, created_at DESC) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_account_status ON orders (account_id, status) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC)`.execute(
    db,
  );

  // ── fills ──────────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills (order_id) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_fills_account_id ON fills (account_id) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_fills_account_symbol ON fills (account_id, symbol, fill_time DESC) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_fills_fill_time ON fills (fill_time DESC)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_fills_exchange_trade_id ON fills (exchange_id, exchange_trade_id)`.execute(
    db,
  );

  // ── executions ─────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_executions_order_id ON executions (order_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_executions_account_id ON executions (account_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_executions_exchange_order ON executions (exchange_id, exchange_order_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions (created_at DESC)`.execute(
    db,
  );

  // ── strategies ─────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_strategies_account_id ON strategies (account_id) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies (status) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_strategies_type ON strategies (type) WHERE deleted_at IS NULL`.execute(
    db,
  );

  // ── strategy_parameters ────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_strategy_params_strategy_id ON strategy_parameters (strategy_id)`.execute(
    db,
  );

  // ── risk_profiles ──────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_risk_profiles_account_id ON risk_profiles (account_id) WHERE deleted_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_risk_profiles_strategy_id ON risk_profiles (strategy_id) WHERE strategy_id IS NOT NULL AND deleted_at IS NULL`.execute(
    db,
  );

  // ── symbols ────────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_symbols_exchange_id ON symbols (exchange_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_symbols_base_quote ON symbols (base_asset, quote_asset)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_symbols_status ON symbols (status)`.execute(db);

  // ── assets ─────────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_assets_is_stable ON assets (is_stable)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_assets_is_fiat ON assets (is_fiat)`.execute(db);

  // ── candles (time-series optimized) ───────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles (exchange_id, symbol, interval, open_time DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON candles (symbol, interval, open_time DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_candles_final ON candles (exchange_id, symbol, interval, is_final, open_time DESC)`.execute(
    db,
  );

  // ── system_logs ────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs (level, created_at DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs (created_at DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_system_logs_correlation ON system_logs (correlation_id) WHERE correlation_id IS NOT NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_system_logs_service ON system_logs (service) WHERE service IS NOT NULL`.execute(
    db,
  );

  // ── audit_logs ─────────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs (table_name, record_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor) WHERE actor IS NOT NULL`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation ON audit_logs (correlation_id) WHERE correlation_id IS NOT NULL`.execute(
    db,
  );

  // ── configuration ──────────────────────────────────────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_configuration_namespace ON configuration (namespace) WHERE deleted_at IS NULL`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const indexes = [
    'idx_accounts_exchange_id',
    'idx_accounts_status',
    'idx_balances_account_id',
    'idx_balances_account_asset',
    'idx_balances_snapshot_at',
    'idx_balances_account_snapshot',
    'idx_positions_account_id',
    'idx_positions_account_symbol',
    'idx_positions_symbol_status',
    'idx_positions_exchange',
    'idx_positions_open',
    'idx_orders_account_id',
    'idx_orders_exchange_order_id',
    'idx_orders_client_order_id',
    'idx_orders_symbol',
    'idx_orders_account_symbol',
    'idx_orders_status',
    'idx_orders_account_status',
    'idx_orders_created_at',
    'idx_fills_order_id',
    'idx_fills_account_id',
    'idx_fills_account_symbol',
    'idx_fills_fill_time',
    'idx_fills_exchange_trade_id',
    'idx_executions_order_id',
    'idx_executions_account_id',
    'idx_executions_exchange_order',
    'idx_executions_created_at',
    'idx_strategies_account_id',
    'idx_strategies_status',
    'idx_strategies_type',
    'idx_strategy_params_strategy_id',
    'idx_risk_profiles_account_id',
    'idx_risk_profiles_strategy_id',
    'idx_symbols_exchange_id',
    'idx_symbols_base_quote',
    'idx_symbols_status',
    'idx_assets_is_stable',
    'idx_assets_is_fiat',
    'idx_candles_lookup',
    'idx_candles_symbol_time',
    'idx_candles_final',
    'idx_system_logs_level',
    'idx_system_logs_created_at',
    'idx_system_logs_correlation',
    'idx_system_logs_service',
    'idx_audit_logs_table_record',
    'idx_audit_logs_created_at',
    'idx_audit_logs_actor',
    'idx_audit_logs_correlation',
    'idx_configuration_namespace',
  ];

  for (const index of indexes) {
    await sql`DROP INDEX IF EXISTS ${sql.id(index)}`.execute(db);
  }
}
