/**
 * Raw Binance REST API response types.
 *
 * These types are internal to the Binance adapter directory.
 * They MUST NOT be imported by any file outside of:
 *   src/modules/exchange/adapters/binance/
 *
 * Every raw type has a corresponding mapper that converts it to a normalized
 * platform model. The mapper output is the only thing that leaves this boundary.
 */

export interface BinanceRawRateLimit {
  rateLimitType: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS';
  interval: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
  intervalNum: number;
  limit: number;
}

export interface BinanceRawSymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  maxNotional?: string;
  applyToMarket?: boolean;
  applyMinToMarket?: boolean;
  limit?: number;
  multiplierUp?: string;
  multiplierDown?: string;
  avgPriceMins?: number;
}

export interface BinanceRawSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quoteAssetPrecision: number;
  quotePrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginalTradingAllowed: boolean;
  filters: BinanceRawSymbolFilter[];
  permissions: string[];
}

export interface BinanceRawExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: BinanceRawRateLimit[];
  symbols: BinanceRawSymbol[];
}

export interface BinanceRawServerTime {
  serverTime: number;
}

export interface BinanceRawTicker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface BinanceRawOrderBook {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface BinanceRawTrade {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}

export interface BinanceRawBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceRawCommissionRates {
  maker: string;
  taker: string;
  buyer: string;
  seller: string;
}

export interface BinanceRawAccount {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  commissionRates: BinanceRawCommissionRates;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: BinanceRawBalance[];
  permissions: string[];
}

export interface BinanceRawFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId: number;
}

export interface BinanceRawOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  stopPrice?: string;
  icebergQty?: string;
  time: number;
  updateTime: number;
  isWorking: boolean;
  workingTime: number;
  origQuoteOrderQty: string;
  transactTime?: number;
  fills?: BinanceRawFill[];
}

export interface BinanceRawCancelReplaceResponse {
  cancelResult: 'SUCCESS' | 'FAILURE';
  newOrderResult: 'SUCCESS' | 'FAILURE' | 'NOT_ATTEMPTED';
  cancelResponse: BinanceRawOrder | null;
  newOrderResponse: BinanceRawOrder | null;
}

export interface BinanceRawErrorBody {
  code: number;
  msg: string;
}

/** Headers parsed from a Binance API response. */
export interface BinanceResponseHeaders {
  usedWeight1m?: number;
  orderCount10s?: number;
  orderCountDay?: number;
  retryAfterSec?: number;
}
