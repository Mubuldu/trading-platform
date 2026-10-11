/**
 * EXCHANGE_TOKENS provides DI injection keys for exchange-layer components.
 *
 * Consumers inject by token to remain decoupled from concrete implementations.
 * Feature modules that need market data inject MARKET_DATA_PROVIDER;
 * they never know which exchange is behind it.
 *
 * Multi-exchange routing:
 *   EXCHANGE_REGISTRY — enhanced registry with enable/disable, health, and
 *                       capability discovery across all registered adapters
 *   EXCHANGE_ROUTER   — routes requests to the correct adapter based on a
 *                       RouteContext (symbol, capabilities, failover policy)
 *
 * In a multi-exchange setup, strategies inject ExchangeRouter and call
 * router.route(context) — they never know which exchange executes the order.
 */
export const EXCHANGE_TOKENS = {
  EXCHANGE_FACTORY: Symbol('ExchangeFactory'),
  ADAPTER_REGISTRY: Symbol('AdapterRegistry'),
  EXCHANGE_REGISTRY: Symbol('ExchangeRegistry'),
  EXCHANGE_ROUTER: Symbol('ExchangeRouter'),
  SYMBOL_NORMALIZER: Symbol('SymbolNormalizer'),
  ORDER_STATUS_NORMALIZER: Symbol('OrderStatusNormalizer'),
  ORDER_VALIDATOR: Symbol('OrderValidator'),
} as const;
