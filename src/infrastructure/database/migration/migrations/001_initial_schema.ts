import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Enable pgcrypto for gen_random_uuid()
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`.execute(db);

  // ── accounts ───────────────────────────────────────────────────────────────
  await db.schema
    .createTable('accounts')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('account_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('external_account_id', 'varchar(256)')
    .addColumn('permissions', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('can_trade', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('can_withdraw', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('can_deposit', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('maker_commission', sql`numeric(18,8)`)
    .addColumn('taker_commission', sql`numeric(18,8)`)
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('active'))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── balances ───────────────────────────────────────────────────────────────
  await db.schema
    .createTable('balances')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (col) => col.notNull().references('accounts.id'))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('asset', 'varchar(32)', (col) => col.notNull())
    .addColumn('free', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('locked', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('total', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('total_equity', sql`numeric(30,8)`)
    .addColumn('total_unrealized_pnl', sql`numeric(30,8)`)
    .addColumn('total_margin_balance', sql`numeric(30,8)`)
    .addColumn('available_balance', sql`numeric(30,8)`)
    .addColumn('snapshot_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── positions ──────────────────────────────────────────────────────────────
  await db.schema
    .createTable('positions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (col) => col.notNull().references('accounts.id'))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('symbol', 'varchar(32)', (col) => col.notNull())
    .addColumn('position_side', 'varchar(16)', (col) => col.notNull())
    .addColumn('margin_mode', 'varchar(16)', (col) => col.notNull())
    .addColumn('leverage', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('entry_price', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('mark_price', sql`numeric(30,8)`)
    .addColumn('quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('notional_value', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('unrealized_pnl', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('realized_pnl', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('liquidation_price', sql`numeric(30,8)`)
    .addColumn('margin_used', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('maintenance_margin', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('position_value', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('is_auto_add_margin', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('open'))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── orders ─────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('orders')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (col) => col.notNull().references('accounts.id'))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('exchange_order_id', 'varchar(256)', (col) => col.notNull())
    .addColumn('client_order_id', 'varchar(256)')
    .addColumn('symbol', 'varchar(32)', (col) => col.notNull())
    .addColumn('side', 'varchar(16)', (col) => col.notNull())
    .addColumn('type', 'varchar(32)', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) => col.notNull())
    .addColumn('time_in_force', 'varchar(16)', (col) => col.notNull())
    .addColumn('position_side', 'varchar(16)')
    .addColumn('original_quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('executed_quantity', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('remaining_quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('cumulative_quote_quantity', sql`numeric(30,8)`, (col) =>
      col.notNull().defaultTo('0'),
    )
    .addColumn('price', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('average_price', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('stop_price', sql`numeric(30,8)`)
    .addColumn('trailing_delta', 'integer')
    .addColumn('reduce_only', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('post_only', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('is_iceberg', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('iceberg_quantity', sql`numeric(30,8)`)
    .addColumn('fee_amount', sql`numeric(30,8)`)
    .addColumn('fee_asset', 'varchar(32)')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── fills ──────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('fills')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('order_id', 'uuid', (col) => col.notNull().references('orders.id'))
    .addColumn('account_id', 'uuid', (col) => col.notNull().references('accounts.id'))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('exchange_trade_id', 'varchar(256)', (col) => col.notNull())
    .addColumn('symbol', 'varchar(32)', (col) => col.notNull())
    .addColumn('side', 'varchar(16)', (col) => col.notNull())
    .addColumn('price', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('quote_quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('commission', sql`numeric(30,8)`)
    .addColumn('commission_asset', 'varchar(32)')
    .addColumn('is_maker', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('fill_time', 'timestamptz', (col) => col.notNull())
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── executions ─────────────────────────────────────────────────────────────
  await db.schema
    .createTable('executions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('order_id', 'uuid', (col) => col.notNull().references('orders.id'))
    .addColumn('account_id', 'uuid', (col) => col.notNull().references('accounts.id'))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('exchange_order_id', 'varchar(256)', (col) => col.notNull())
    .addColumn('exchange_trade_id', 'varchar(256)')
    .addColumn('client_order_id', 'varchar(256)')
    .addColumn('symbol', 'varchar(32)', (col) => col.notNull())
    .addColumn('side', 'varchar(16)', (col) => col.notNull())
    .addColumn('type', 'varchar(32)', (col) => col.notNull())
    .addColumn('previous_status', 'varchar(32)', (col) => col.notNull())
    .addColumn('current_status', 'varchar(32)', (col) => col.notNull())
    .addColumn('position_side', 'varchar(16)')
    .addColumn('last_executed_quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('last_executed_price', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('cumulative_filled_quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('cumulative_quote_quantity', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('commission_amount', sql`numeric(30,8)`)
    .addColumn('commission_asset', 'varchar(32)')
    .addColumn('is_maker', 'boolean')
    .addColumn('is_liquidation', 'boolean')
    .addColumn('is_reduce_only', 'boolean')
    .addColumn('working_time', 'timestamptz', (col) => col.notNull())
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── strategies ─────────────────────────────────────────────────────────────
  await db.schema
    .createTable('strategies')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('type', 'varchar(64)', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('stopped'))
    .addColumn('account_id', 'uuid', (col) => col.notNull().references('accounts.id'))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('symbols', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── strategy_parameters ────────────────────────────────────────────────────
  await db.schema
    .createTable('strategy_parameters')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('strategy_id', 'uuid', (col) =>
      col.notNull().references('strategies.id').onDelete('cascade'),
    )
    .addColumn('key', 'varchar(128)', (col) => col.notNull())
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addColumn('type', 'varchar(32)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── risk_profiles ──────────────────────────────────────────────────────────
  await db.schema
    .createTable('risk_profiles')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('account_id', 'uuid', (col) => col.notNull().references('accounts.id'))
    .addColumn('strategy_id', 'uuid')
    .addColumn('max_position_size', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('max_daily_loss', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('max_drawdown', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('max_leverage', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('max_open_orders', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('allowed_symbols', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('blocked_symbols', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('active'))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── symbols ────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('symbols')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('symbol', 'varchar(32)', (col) => col.notNull())
    .addColumn('exchange_symbol', 'varchar(64)', (col) => col.notNull())
    .addColumn('base_asset', 'varchar(32)', (col) => col.notNull())
    .addColumn('quote_asset', 'varchar(32)', (col) => col.notNull())
    .addColumn('instrument_type', 'varchar(32)', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) => col.notNull())
    .addColumn('base_precision', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('quote_precision', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('min_quantity', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('max_quantity', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('step_size', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('min_notional', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('price_precision', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('tick_size', sql`numeric(30,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('metadata', 'jsonb')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── assets ─────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('assets')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('symbol', 'varchar(32)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('precision', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('is_fiat', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('is_stable', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('metadata', 'jsonb')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── exchange_metadata ──────────────────────────────────────────────────────
  await db.schema
    .createTable('exchange_metadata')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('maker_fee', sql`numeric(18,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('taker_fee', sql`numeric(18,8)`, (col) => col.notNull().defaultTo('0'))
    .addColumn('rate_limits', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('supports_spot', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('supports_futures', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('supports_margin', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('server_time_offset_ms', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('online'))
    .addColumn('metadata', 'jsonb')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── candles ────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('candles')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('exchange_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('symbol', 'varchar(32)', (col) => col.notNull())
    .addColumn('interval', 'varchar(8)', (col) => col.notNull())
    .addColumn('open_time', 'timestamptz', (col) => col.notNull())
    .addColumn('close_time', 'timestamptz', (col) => col.notNull())
    .addColumn('open', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('high', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('low', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('close', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('volume', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('quote_volume', sql`numeric(30,8)`, (col) => col.notNull())
    .addColumn('trade_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_final', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── system_logs ────────────────────────────────────────────────────────────
  await db.schema
    .createTable('system_logs')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('level', 'varchar(16)', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('context', 'varchar(128)')
    .addColumn('correlation_id', 'uuid')
    .addColumn('service', 'varchar(128)')
    .addColumn('metadata', 'jsonb')
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── audit_logs ─────────────────────────────────────────────────────────────
  await db.schema
    .createTable('audit_logs')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('table_name', 'varchar(64)', (col) => col.notNull())
    .addColumn('record_id', 'uuid', (col) => col.notNull())
    .addColumn('operation', 'varchar(16)', (col) => col.notNull())
    .addColumn('actor', 'varchar(256)')
    .addColumn('reason', 'text')
    .addColumn('old_value', 'jsonb')
    .addColumn('new_value', 'jsonb')
    .addColumn('correlation_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── configuration ──────────────────────────────────────────────────────────
  await db.schema
    .createTable('configuration')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('namespace', 'varchar(128)', (col) => col.notNull())
    .addColumn('key', 'varchar(256)', (col) => col.notNull())
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addColumn('type', 'varchar(32)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_secret', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Unique constraint: one config value per namespace+key (soft-delete aware)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_configuration_namespace_key
    ON configuration (namespace, key)
    WHERE deleted_at IS NULL
  `.execute(db);

  // Unique constraint: one symbol per exchange
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_symbols_exchange_symbol
    ON symbols (exchange_id, symbol)
  `.execute(db);

  // Unique constraint: one strategy param key per strategy
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_params_key
    ON strategy_parameters (strategy_id, key)
  `.execute(db);

  // Candle uniqueness: one candle per exchange+symbol+interval+open_time
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_candles_exchange_symbol_interval_time
    ON candles (exchange_id, symbol, interval, open_time)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const tables = [
    'audit_logs',
    'system_logs',
    'configuration',
    'candles',
    'exchange_metadata',
    'assets',
    'symbols',
    'risk_profiles',
    'strategy_parameters',
    'strategies',
    'executions',
    'fills',
    'orders',
    'positions',
    'balances',
    'accounts',
  ];

  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
