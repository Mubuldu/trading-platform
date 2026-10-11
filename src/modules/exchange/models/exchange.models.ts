import { ExchangeId, MarketType } from '../enums/exchange.enums';
import { NormalizedSymbol } from './common.model';

/**
 * SymbolInfo contains the trading rules and precision for a single symbol.
 *
 * This is the primary input to the OrderValidator. Before submitting any
 * order, the validator checks the order against these constraints.
 *
 * Precision fields use decimal place counts, not tick sizes, to avoid
 * floating-point comparison issues.
 */
export interface SymbolInfo {
  readonly symbol: NormalizedSymbol;
  readonly exchangeSymbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly exchangeId: ExchangeId;
  readonly marketType: MarketType;
  readonly isActive: boolean;

  readonly pricePrecision: number;
  readonly quantityPrecision: number;
  readonly quotePrecision: number;

  readonly minQuantity: number;
  readonly maxQuantity: number;
  readonly stepSize: number;
  readonly minPrice: number;
  readonly maxPrice: number;
  readonly tickSize: number;
  readonly minNotional: number;
  readonly maxNotional?: number;

  readonly contractSize?: number;
  readonly maxLeverage?: number;
  readonly isSettled?: boolean;
  readonly settlementDate?: Date;
  readonly underlyingAsset?: string;

  readonly allowsLimitOrder: boolean;
  readonly allowsMarketOrder: boolean;
  readonly allowsStopOrder: boolean;
  readonly allowsPostOnly: boolean;
  readonly allowsReduceOnly: boolean;
  readonly allowsIceberg: boolean;
}

/**
 * RateLimitInfo describes a single rate limit rule from the exchange.
 */
export interface RateLimitInfo {
  readonly rateLimitType: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS';
  readonly interval: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
  readonly intervalNum: number;
  readonly limit: number;
}

/**
 * RateLimitStatus is the real-time view of rate limit consumption.
 * The adapter updates this on every API response.
 */
export interface RateLimitStatus {
  readonly exchangeId: ExchangeId;
  readonly category: 'request' | 'order' | 'raw_request';
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly weight: number;
  readonly resetsAt: Date;
  readonly checkedAt: Date;
}

/**
 * ExchangeInfo is the global metadata snapshot for an exchange.
 *
 * Retrieved at startup and periodically refreshed. The adapter caches this
 * and uses it to populate SymbolInfo for the SymbolNormalizer.
 *
 * isMaintenance: if true, the exchange has signalled planned downtime.
 * The adapter should reject new orders with ExchangeMaintenanceError.
 */
export interface ExchangeInfo {
  readonly exchangeId: ExchangeId;
  readonly serverTime: Date;
  readonly timezone: string;
  readonly rateLimits: RateLimitInfo[];
  readonly symbols: SymbolInfo[];
  readonly isMaintenance: boolean;
  readonly maintenanceMessage?: string;
}

/**
 * ExchangeCapabilities declares which features an exchange supports.
 *
 * Every adapter must populate this accurately. The execution engine and
 * strategy engine check capabilities before submitting orders.
 *
 * Market-type flags:
 *   supportsSpot          — classic spot trading (buy/sell with settlement)
 *   supportsPerpetual     — perpetual/swap contracts (no expiry)
 *   supportsFutures       — dated delivery contracts
 *   supportsOptions       — options contracts (calls/puts)
 *   supportsMargin        — leverage on spot via borrowed funds
 *   supportsCrossMargin   — shared margin pool across positions
 *   supportsIsolatedMargin — per-position margin isolation
 *
 * Order feature flags:
 *   supportsOco             — One-Cancels-the-Other linked orders
 *   supportsTpSl            — exchange-native take-profit / stop-loss
 *   supportsBatchOrders     — submit/cancel multiple orders in one call
 *   supportsReduceOnly      — reduce-only order flag (futures)
 *   supportsHedgeMode       — simultaneous long+short on same symbol (futures)
 *   supportsTrailingStop    — trailing stop orders (percentage or amount)
 *   supportsPostOnly        — post-only flag to guarantee maker fee
 *   supportsConditionalOrders — conditional/trigger orders (Bybit / OKX algo)
 *   supportsWebSocket       — real-time data feeds via WebSocket
 *   maxBatchOrderSize       — maximum orders per batch call (0 = not supported)
 *
 * Note: capabilities may vary between ExchangeId variants of the same brand
 * (e.g. binance_spot does not support hedge mode; binance_futures_usdt does).
 */
export interface ExchangeCapabilities {
  // ── Market types ──────────────────────────────────────────────────────────
  readonly supportsSpot: boolean;
  readonly supportsPerpetual: boolean;
  readonly supportsFutures: boolean;
  readonly supportsOptions: boolean;
  readonly supportsMargin: boolean;
  readonly supportsCrossMargin: boolean;
  readonly supportsIsolatedMargin: boolean;

  // ── Order features ────────────────────────────────────────────────────────
  readonly supportsOco: boolean;
  readonly supportsTpSl: boolean;
  readonly supportsBatchOrders: boolean;
  readonly supportsReduceOnly: boolean;
  readonly supportsHedgeMode: boolean;
  readonly supportsTrailingStop: boolean;
  readonly supportsPostOnly: boolean;
  readonly supportsConditionalOrders: boolean;
  readonly supportsWebSocket: boolean;
  readonly maxBatchOrderSize: number;
}
