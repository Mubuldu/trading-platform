import * as Joi from 'joi';

/**
 * Joi schema that validates all required environment variables before the
 * application boots. Any validation failure causes an immediate process exit
 * with a descriptive error message вЂ” no silent misconfiguration.
 *
 * allowUnknown: true  вЂ” permits OS-level env vars (PATH, HOME, etc.)
 * abortEarly:   false вЂ” surfaces every violation in one pass
 */
export const envValidationSchema = Joi.object({
  // в”Ђв”Ђ Application в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').required().messages({
    'any.only': 'NODE_ENV must be one of: development, test, staging, production',
    'any.required': 'NODE_ENV is required',
  }),

  APP_NAME: Joi.string().min(1).max(64).required().messages({
    'any.required': 'APP_NAME is required',
  }),

  APP_PORT: Joi.number().port().default(3000),

  APP_VERSION: Joi.string()
    .pattern(/^\d+\.\d+\.\d+$/)
    .required()
    .messages({
      'string.pattern.base': 'APP_VERSION must be a valid semver string (e.g. 1.0.0)',
      'any.required': 'APP_VERSION is required',
    }),

  SWAGGER_ENABLED: Joi.boolean().default(true),
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),

  // в”Ђв”Ђ Security в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  API_KEY_SECRET: Joi.string().min(32).required().messages({
    'string.min': 'API_KEY_SECRET must be at least 32 characters',
    'any.required': 'API_KEY_SECRET is required',
  }),

  // в”Ђв”Ђ Logging в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),
  LOG_DIR: Joi.string().default('./logs'),
  LOG_MAX_FILE_SIZE_MB: Joi.number().integer().min(1).max(1000).default(50),
  LOG_MAX_FILES: Joi.string().default('30d'),
  LOG_ERROR_MAX_FILES: Joi.string().default('90d'),
  LOG_CONSOLE_ENABLED: Joi.boolean().default(true),
  LOG_JSON_OUTPUT: Joi.boolean().default(false),

  // в”Ђв”Ђ Secrets Provider в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  SECRETS_PROVIDER: Joi.string().valid('env', 'docker').default('env'),
  DOCKER_SECRETS_PATH: Joi.string().default('/run/secrets'),

  // в”Ђв”Ђ Exchange (generic) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  EXCHANGE_DEFAULT_ID: Joi.string().default('BINANCE_SPOT'),
  EXCHANGE_MARKET_DATA_CACHE_TTL_MS: Joi.number().integer().min(1000).default(300_000),
  EXCHANGE_ORDER_BOOK_DEPTH: Joi.number().integer().min(1).max(5000).default(20),
  EXCHANGE_TICKER_CACHE_TTL_MS: Joi.number().integer().min(100).default(5_000),
  EXCHANGE_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(1000).default(10_000),
  EXCHANGE_ENABLED: Joi.string().allow('').default(''),

  // в”Ђв”Ђ Binance Spot REST Adapter в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  BINANCE_SPOT_API_KEY: Joi.string().allow('').default(''),
  BINANCE_SPOT_SECRET_KEY: Joi.string().allow('').default(''),
  BINANCE_SPOT_BASE_URL: Joi.string().uri().default('https://api.binance.com'),
  BINANCE_SPOT_TESTNET: Joi.boolean().default(false),
  BINANCE_SPOT_TIMEOUT_MS: Joi.number().integer().positive().default(10_000),
  BINANCE_SPOT_RECV_WINDOW_MS: Joi.number().integer().min(1).max(60_000).default(5_000),
  BINANCE_SPOT_MAX_RETRIES: Joi.number().integer().min(0).max(10).default(3),
  BINANCE_SPOT_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),

  // в”Ђв”Ђ Binance Spot WebSocket Adapter в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  BINANCE_SPOT_WS_BASE_URL: Joi.string().default('wss://stream.binance.com:9443'),
  BINANCE_SPOT_WS_HEARTBEAT_INTERVAL_MS: Joi.number()
    .integer()
    .min(5_000)
    .max(60_000)
    .default(20_000),
  BINANCE_SPOT_WS_HEARTBEAT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(30_000)
    .default(10_000),
  BINANCE_SPOT_WS_MISSED_HEARTBEATS: Joi.number().integer().min(1).max(10).default(3),
  BINANCE_SPOT_WS_RECONNECT_BASE_DELAY_MS: Joi.number()
    .integer()
    .min(100)
    .max(10_000)
    .default(1_000),
  BINANCE_SPOT_WS_RECONNECT_MAX_DELAY_MS: Joi.number()
    .integer()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  BINANCE_SPOT_WS_MAX_RECONNECT_ATTEMPTS: Joi.number().integer().min(-1).max(100).default(10),
  BINANCE_SPOT_WS_RECONNECT_STABLE_MS: Joi.number()
    .integer()
    .min(5_000)
    .max(120_000)
    .default(30_000),
  BINANCE_SPOT_WS_MAX_STREAMS: Joi.number().integer().min(1).max(1_024).default(200),
  BINANCE_SPOT_WS_MAX_MESSAGE_SIZE_BYTES: Joi.number().integer().min(65_536).default(10_485_760),

  // в”Ђв”Ђ Redis Event Streaming Layer в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_KEY_PREFIX: Joi.string().default('tp:'),
  REDIS_STREAM_MAXLEN: Joi.number().integer().min(1_000).default(100_000),
  REDIS_STREAM_APPROX_MAXLEN: Joi.boolean().default(true),
  REDIS_CONSUMER_BLOCK_TIMEOUT_MS: Joi.number().integer().min(0).default(2_000),
  REDIS_CONSUMER_BATCH_SIZE: Joi.number().integer().min(1).max(1_000).default(10),
  REDIS_CONSUMER_MAX_RETRIES: Joi.number().integer().min(0).max(100).default(3),
  REDIS_CONSUMER_PROCESSING_TIMEOUT_MS: Joi.number().integer().min(1_000).default(30_000),
  REDIS_CONSUMER_PENDING_RECOVERY_INTERVAL_MS: Joi.number().integer().min(1_000).default(60_000),
  REDIS_CONSUMER_IDLE_TIMEOUT_MS: Joi.number().integer().min(10_000).default(300_000),
  REDIS_RECONNECT_MAX_RETRIES: Joi.number().integer().min(-1).max(100).default(20),
  REDIS_RECONNECT_DELAY_MS: Joi.number().integer().min(100).max(10_000).default(1_000),
  REDIS_RECONNECT_MAX_DELAY_MS: Joi.number().integer().min(1_000).max(300_000).default(30_000),
  REDIS_HEALTH_CHECK_INTERVAL_MS: Joi.number().integer().min(5_000).default(30_000),
  REDIS_HEALTH_LATENCY_WARN_MS: Joi.number().integer().min(1).default(100),

  // в”Ђв”Ђ PostgreSQL Database в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_NAME: Joi.string().default('trading_platform'),
  DB_USER: Joi.string().default('trading'),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_SSL: Joi.boolean().default(false),
  DB_POOL_MIN: Joi.number().integer().min(1).max(10).default(2),
  DB_POOL_MAX: Joi.number().integer().min(2).max(100).default(20),
  DB_IDLE_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  DB_ACQUIRE_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  DB_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(100).default(5000),
  DB_MIGRATE_ON_STARTUP: Joi.boolean().default(true),
  DB_MIGRATION_TABLE: Joi.string().default('kysely_migration'),
  DB_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  DB_QUERY_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),

  // в”Ђв”Ђ Monitoring в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  METRICS_ENABLED: Joi.boolean().default(true),
  METRICS_PREFIX: Joi.string().min(1).max(64).default('trading_platform'),
  METRICS_COLLECTION_INTERVAL_MS: Joi.number().integer().min(1000).default(15_000),
  MONITORING_LATENCY_WARN_MS: Joi.number().integer().min(1).default(100),
  MONITORING_ERROR_RATE_WARN_PERCENT: Joi.number().min(0).max(100).default(5),
  MONITORING_MEMORY_WARN_PERCENT: Joi.number().min(0).max(100).default(80),
  MONITORING_CPU_WARN_PERCENT: Joi.number().min(0).max(100).default(80),

  // в”Ђв”Ђ Risk Management (hot-reloadable) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  RISK_ENABLED: Joi.boolean().default(true),
  RISK_MAX_POSITION_SIZE_USD: Joi.number().positive().default(100_000),
  RISK_MAX_DRAWDOWN_PERCENT: Joi.number().min(0).max(100).default(10),
  RISK_MAX_DAILY_LOSS_USD: Joi.number().positive().default(5_000),
  RISK_MAX_ORDER_SIZE_USD: Joi.number().positive().default(10_000),
  RISK_MAX_LEVERAGE: Joi.number().min(1).max(100).default(3),
  RISK_MAX_OPEN_ORDERS: Joi.number().integer().min(1).max(1000).default(50),
  RISK_MAX_CONCENTRATION_PERCENT: Joi.number().min(1).max(100).default(30),

  // в”Ђв”Ђ Strategy (hot-reloadable) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  STRATEGY_ENABLED_IDS: Joi.string().allow('').default(''),
  STRATEGY_DEFAULT_SYMBOL: Joi.string().default('BTC/USDT'),
  STRATEGY_MAX_CONCURRENT: Joi.number().integer().min(1).max(100).default(5),
  STRATEGY_HEARTBEAT_INTERVAL_MS: Joi.number().integer().min(1000).default(5_000),
  STRATEGY_ORDER_COOLDOWN_MS: Joi.number().integer().min(0).default(1_000),

  // в”Ђв”Ђ Order Execution в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  EXECUTION_ENABLED: Joi.boolean().default(true),
  EXECUTION_ORDER_ROUTING_MODE: Joi.string().valid('direct', 'smart', 'vwap').default('direct'),
  EXECUTION_SLIPPAGE_TOLERANCE_BPS: Joi.number().integer().min(0).max(1000).default(10),
  EXECUTION_MAX_SLIPPAGE_BPS: Joi.number().integer().min(0).max(10_000).default(50),
  EXECUTION_RETRY_ON_PARTIAL_FILL: Joi.boolean().default(false),
  EXECUTION_MAX_RETRIES: Joi.number().integer().min(0).max(10).default(3),
  EXECUTION_ORDER_TIMEOUT_MS: Joi.number().integer().min(1000).default(30_000),
  EXECUTION_CANCEL_ON_TIMEOUT: Joi.boolean().default(true),

  // в”Ђв”Ђ Backtesting в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  BACKTESTING_DATA_DIR: Joi.string().default('./data/backtesting'),
  BACKTESTING_RESULTS_DIR: Joi.string().default('./data/results'),
  BACKTESTING_DEFAULT_COMMISSION_BPS: Joi.number().integer().min(0).max(1000).default(10),
  BACKTESTING_DEFAULT_SLIPPAGE_BPS: Joi.number().integer().min(0).max(1000).default(5),
  BACKTESTING_DEFAULT_INITIAL_CAPITAL_USD: Joi.number().positive().default(100_000),
  BACKTESTING_MAX_WORKERS: Joi.number().integer().min(1).max(64).default(4),

  // в”Ђв”Ђ Paper Trading в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  PAPER_TRADING_ENABLED: Joi.boolean().default(false),
  PAPER_TRADING_INITIAL_BALANCE_USD: Joi.number().positive().default(100_000),
  PAPER_TRADING_SIMULATE_SLIPPAGE: Joi.boolean().default(true),
  PAPER_TRADING_SIMULATE_LATENCY: Joi.boolean().default(true),
  PAPER_TRADING_LATENCY_MS: Joi.number().integer().min(0).max(10_000).default(50),
  PAPER_TRADING_SLIPPAGE_BPS: Joi.number().integer().min(0).max(1000).default(5),
  PAPER_TRADING_RESET_ON_RESTART: Joi.boolean().default(false),

  // в”Ђв”Ђ Alerts (hot-reloadable) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  ALERTS_ENABLED: Joi.boolean().default(true),
  ALERTS_COOLDOWN_SECONDS: Joi.number().integer().min(0).max(86_400).default(300),
  ALERTS_ESCALATION_THRESHOLD: Joi.number().integer().min(1).max(100).default(3),
  ALERTS_ESCALATION_WINDOW_SECONDS: Joi.number().integer().min(60).max(86_400).default(900),
  ALERTS_PRICE_DEVIATION_WARN_PERCENT: Joi.number().min(0).max(100).default(5),
  ALERTS_LATENCY_WARN_MS: Joi.number().integer().min(1).default(500),
  ALERTS_ERROR_RATE_WARN_PERCENT: Joi.number().min(0).max(100).default(10),
  ALERTS_DRAWDOWN_WARN_PERCENT: Joi.number().min(0).max(100).default(5),
  ALERTS_POSITION_WARN_PERCENT: Joi.number().min(0).max(100).default(80),
  ALERTS_FILL_RATE_WARN_PERCENT: Joi.number().min(0).max(100).default(95),
  ALERTS_CPU_WARN_PERCENT: Joi.number().min(0).max(100).default(85),
  ALERTS_MEMORY_WARN_PERCENT: Joi.number().min(0).max(100).default(85),
  ALERTS_DISK_WARN_PERCENT: Joi.number().min(0).max(100).default(85),
  ALERTS_QUEUE_LAG_WARN_MESSAGES: Joi.number().integer().min(1).default(1000),

  // ── Alert routing ─────────────────────────────────────────────────────────
  ALERT_ROUTE_INFO: Joi.string().allow('').default(''),
  ALERT_ROUTE_WARNING: Joi.string().allow('').default(''),
  ALERT_ROUTE_ERROR: Joi.string().allow('').default('discord,slack'),
  ALERT_ROUTE_CRITICAL: Joi.string().allow('').default('discord,slack,telegram,webhook'),
  ALERT_ROUTE_FATAL: Joi.string().allow('').default('discord,slack,telegram,email,webhook'),

  // ── Alert channels ────────────────────────────────────────────────────────
  ALERT_EMAIL_ENABLED: Joi.boolean().default(false),
  ALERT_EMAIL_HOST: Joi.string().default('smtp.gmail.com'),
  ALERT_EMAIL_PORT: Joi.number().port().default(465),
  ALERT_EMAIL_SECURE: Joi.boolean().default(true),
  ALERT_EMAIL_USER: Joi.string().allow('').default(''),
  ALERT_EMAIL_PASSWORD: Joi.string().allow('').default(''),
  ALERT_EMAIL_FROM: Joi.string().allow('').default(''),
  ALERT_EMAIL_TO: Joi.string().allow('').default(''),
  ALERT_EMAIL_TIMEOUT_MS: Joi.number().integer().min(1000).max(30_000).default(10_000),

  ALERT_DISCORD_ENABLED: Joi.boolean().default(false),
  ALERT_DISCORD_WEBHOOK_URL: Joi.string().allow('').default(''),
  ALERT_DISCORD_USERNAME: Joi.string().allow('').default('TradingBot Alerts'),
  ALERT_DISCORD_TIMEOUT_MS: Joi.number().integer().min(1000).max(30_000).default(5_000),

  ALERT_TELEGRAM_ENABLED: Joi.boolean().default(false),
  ALERT_TELEGRAM_BOT_TOKEN: Joi.string().allow('').default(''),
  ALERT_TELEGRAM_CHAT_ID: Joi.string().allow('').default(''),
  ALERT_TELEGRAM_TIMEOUT_MS: Joi.number().integer().min(1000).max(30_000).default(5_000),

  ALERT_SLACK_ENABLED: Joi.boolean().default(false),
  ALERT_SLACK_WEBHOOK_URL: Joi.string().allow('').default(''),
  ALERT_SLACK_CHANNEL: Joi.string().allow('').default('#alerts'),
  ALERT_SLACK_USERNAME: Joi.string().allow('').default('TradingBot Alerts'),
  ALERT_SLACK_TIMEOUT_MS: Joi.number().integer().min(1000).max(30_000).default(5_000),

  ALERT_WEBHOOK_ENABLED: Joi.boolean().default(false),
  ALERT_WEBHOOK_URL: Joi.string().allow('').default(''),
  ALERT_WEBHOOK_METHOD: Joi.string().valid('POST', 'PUT').default('POST'),
  ALERT_WEBHOOK_HEADERS: Joi.string().allow('').default('{}'),
  ALERT_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  ALERT_WEBHOOK_TIMEOUT_MS: Joi.number().integer().min(1000).max(30_000).default(5_000),

  // ── Indicator Engine ──────────────────────────────────────────────────────
  INDICATOR_WARMUP_TIMEOUT_MS: Joi.number().integer().min(1000).default(120_000),
  INDICATOR_MAX_FUTURE_SKEW_MS: Joi.number().integer().min(0).default(5_000),
  INDICATOR_DEFAULT_EXCHANGE_ID: Joi.string().default('BINANCE_SPOT'),
  INDICATOR_DEFAULT_SYMBOLS: Joi.string().default('BTC/USDT'),

  // ── Portfolio Manager ─────────────────────────────────────────────────────
  PORTFOLIO_MANAGER_ENABLED: Joi.boolean().default(true),
  PORTFOLIO_CONSUMER_GROUP: Joi.string().default('portfolio-manager'),
  PORTFOLIO_DEFAULT_EQUITY_USD: Joi.number().positive().default(100_000),
  PORTFOLIO_DEFAULT_ACCOUNT_ID: Joi.string().default('default'),
  PORTFOLIO_ALLOCATION_METHOD: Joi.string()
    .valid('EQUAL_WEIGHT', 'RISK_WEIGHT', 'VOLATILITY_WEIGHT', 'KELLY_WEIGHT', 'CUSTOM')
    .default('EQUAL_WEIGHT'),
  PORTFOLIO_MAX_POSITION_SIZE_PERCENT: Joi.number().min(1).max(100).default(20),
  PORTFOLIO_MAX_EXPOSURE_PERCENT: Joi.number().min(1).max(500).default(80),
  PORTFOLIO_MAX_LEVERAGE: Joi.number().min(1).max(100).default(3),
  PORTFOLIO_MAX_CORRELATION: Joi.number().min(0).max(1).default(0.8),
  PORTFOLIO_MAX_ASSET_ALLOCATION_PERCENT: Joi.number().min(1).max(100).default(40),
  PORTFOLIO_ROLLING_DRAWDOWN_DAYS: Joi.number().integer().min(1).max(365).default(30),
  PORTFOLIO_RISK_FREE_RATE: Joi.number().min(0).max(1).default(0.05),
  PORTFOLIO_TRADING_DAYS_PER_YEAR: Joi.number().integer().min(200).max(365).default(252),
  PORTFOLIO_SNAPSHOT_INTERVAL_MS: Joi.number().integer().min(60_000).default(3_600_000),
  PORTFOLIO_METRICS_RETENTION_DAYS: Joi.number().integer().min(30).max(3650).default(365),

  // ── Horizontal Cluster ───────────────────────────────────────────────────
  CLUSTER_ENABLED: Joi.boolean().default(false),
  CLUSTER_NODE_ID: Joi.string().allow('').default(''),
  CLUSTER_NODE_LABEL: Joi.string().allow('').default(''),
  CLUSTER_WORKER_CAPABILITIES: Joi.string()
    .allow('')
    .default('indicator,strategy,analytics,backtest,risk,execution'),
  CLUSTER_HEARTBEAT_INTERVAL_MS: Joi.number().integer().min(500).max(30_000).default(3_000),
  CLUSTER_HEARTBEAT_TTL_MS: Joi.number().integer().min(1_000).max(60_000).default(10_000),
  CLUSTER_DEAD_WORKER_CHECK_INTERVAL_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(5_000),
  CLUSTER_LEADER_LEASE_TTL_MS: Joi.number().integer().min(5_000).max(300_000).default(30_000),
  CLUSTER_LEADER_RENEWAL_INTERVAL_MS: Joi.number().integer().min(1_000).max(60_000).default(10_000),
  CLUSTER_TASK_DISTRIBUTION_STRATEGY: Joi.string()
    .valid('round-robin', 'least-loaded', 'sticky', 'weighted')
    .default('round-robin'),
  CLUSTER_METRICS_PUBLISH_INTERVAL_MS: Joi.number().integer().min(1_000).max(60_000).default(5_000),
  CLUSTER_METRICS_TTL_MS: Joi.number().integer().min(5_000).max(300_000).default(30_000),
  CLUSTER_DEFAULT_LOCK_TTL_MS: Joi.number().integer().min(1_000).max(300_000).default(30_000),
  CLUSTER_LOCK_WAIT_MS: Joi.number().integer().min(0).max(60_000).default(5_000),
  CLUSTER_LOCK_RETRY_INTERVAL_MS: Joi.number().integer().min(10).max(5_000).default(50),
  CLUSTER_LOCK_RETRY_JITTER_MS: Joi.number().integer().min(0).max(1_000).default(25),
}).options({ allowUnknown: true, abortEarly: false });

/**
 * Joi sub-schema for the hot-reloadable subset. Applied by ReloadableConfigService
 * on SIGHUP before committing new values. A failed sub-schema validation retains
 * the previous configuration unchanged.
 */
export const reloadableEnvSchema = Joi.object({
  RISK_ENABLED: Joi.boolean().default(true),
  RISK_MAX_POSITION_SIZE_USD: Joi.number().positive().default(100_000),
  RISK_MAX_DRAWDOWN_PERCENT: Joi.number().min(0).max(100).default(10),
  RISK_MAX_DAILY_LOSS_USD: Joi.number().positive().default(5_000),
  RISK_MAX_ORDER_SIZE_USD: Joi.number().positive().default(10_000),
  RISK_MAX_LEVERAGE: Joi.number().min(1).max(100).default(3),
  RISK_MAX_OPEN_ORDERS: Joi.number().integer().min(1).max(1000).default(50),
  RISK_MAX_CONCENTRATION_PERCENT: Joi.number().min(0).max(100).default(30),

  STRATEGY_ENABLED_IDS: Joi.string().allow('').default(''),
  STRATEGY_DEFAULT_SYMBOL: Joi.string().default('BTC/USDT'),
  STRATEGY_MAX_CONCURRENT: Joi.number().integer().min(1).max(100).default(5),
  STRATEGY_HEARTBEAT_INTERVAL_MS: Joi.number().integer().min(1000).default(5_000),
  STRATEGY_ORDER_COOLDOWN_MS: Joi.number().integer().min(0).default(1_000),

  MONITORING_LATENCY_WARN_MS: Joi.number().integer().min(1).default(100),
  MONITORING_ERROR_RATE_WARN_PERCENT: Joi.number().min(0).max(100).default(5),
  MONITORING_MEMORY_WARN_PERCENT: Joi.number().min(0).max(100).default(80),
  MONITORING_CPU_WARN_PERCENT: Joi.number().min(0).max(100).default(80),

  ALERTS_ENABLED: Joi.boolean().default(true),
  ALERTS_COOLDOWN_SECONDS: Joi.number().integer().min(0).max(86_400).default(300),
  ALERTS_ESCALATION_THRESHOLD: Joi.number().integer().min(1).max(100).default(3),
  ALERTS_ESCALATION_WINDOW_SECONDS: Joi.number().integer().min(60).max(86_400).default(900),
  ALERTS_PRICE_DEVIATION_WARN_PERCENT: Joi.number().min(0).max(100).default(5),
  ALERTS_LATENCY_WARN_MS: Joi.number().integer().min(1).default(500),
  ALERTS_ERROR_RATE_WARN_PERCENT: Joi.number().min(0).max(100).default(10),
  ALERTS_DRAWDOWN_WARN_PERCENT: Joi.number().min(0).max(100).default(5),
  ALERTS_POSITION_WARN_PERCENT: Joi.number().min(0).max(100).default(80),
  ALERTS_FILL_RATE_WARN_PERCENT: Joi.number().min(0).max(100).default(95),
  ALERTS_CPU_WARN_PERCENT: Joi.number().min(0).max(100).default(85),
  ALERTS_MEMORY_WARN_PERCENT: Joi.number().min(0).max(100).default(85),
  ALERTS_DISK_WARN_PERCENT: Joi.number().min(0).max(100).default(85),
  ALERTS_QUEUE_LAG_WARN_MESSAGES: Joi.number().integer().min(1).default(1000),

  // ── Indicator Engine ──────────────────────────────────────────────────────
  INDICATOR_WARMUP_TIMEOUT_MS: Joi.number().integer().min(1000).default(120_000),
  INDICATOR_MAX_FUTURE_SKEW_MS: Joi.number().integer().min(0).default(5_000),
  INDICATOR_DEFAULT_EXCHANGE_ID: Joi.string().default('BINANCE_SPOT'),
  INDICATOR_DEFAULT_SYMBOLS: Joi.string().default('BTC/USDT'),
}).options({ allowUnknown: true, abortEarly: false });
