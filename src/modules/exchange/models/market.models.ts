import { ExchangeModelBase } from './common.model';
import { OrderSide, TimeInForce } from '../enums/order.enums';
import { OrderType } from '../enums/order.enums';
import { OrderStatus } from '../enums/order.enums';

/**
 * MarketTick is the minimal, real-time best bid/ask snapshot.
 * Published on every quote update from the exchange WebSocket feed.
 * Used by: strategy engine for signal generation, execution engine for
 * smart order routing, risk engine for mark-to-market.
 */
export interface MarketTick extends ExchangeModelBase {
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly bestBidQuantity: number;
  readonly bestAskQuantity: number;
  readonly spread: number;
  readonly midPrice: number;
}

/**
 * Ticker is a 24-hour rolling statistics snapshot.
 * Extends MarketTick with OHLCV and volume data.
 */
export interface Ticker extends MarketTick {
  readonly openPrice: number;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly closePrice: number;
  readonly lastPrice: number;
  readonly lastQuantity: number;
  readonly volume: number;
  readonly quoteVolume: number;
  readonly priceChange: number;
  readonly priceChangePercent: number;
  readonly weightedAveragePrice: number;
  readonly openTime: Date;
  readonly closeTime: Date;
  readonly tradeCount: number;
}

/**
 * OrderBookLevel represents a single price level in the order book.
 */
export interface OrderBookLevel {
  readonly price: number;
  readonly quantity: number;
}

/**
 * OrderBook is a normalized L2 order book snapshot or update.
 *
 * lastUpdateId is the exchange's sequence number. Consumers should
 * use this to detect gaps in incremental update streams.
 */
export interface OrderBook extends ExchangeModelBase {
  readonly lastUpdateId: number;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly depth: number;
  readonly isSnapshot: boolean;
}

/**
 * Trade is a single executed trade from the exchange public trade feed.
 */
export interface Trade extends ExchangeModelBase {
  readonly tradeId: string;
  readonly price: number;
  readonly quantity: number;
  readonly quoteQuantity: number;
  readonly side: OrderSide;
  readonly isBuyerMaker: boolean;
}

/**
 * FundingRate is the periodic funding payment for perpetual futures contracts.
 * Published at each funding interval (typically every 8 hours).
 */
export interface FundingRate extends ExchangeModelBase {
  readonly rate: number;
  readonly fundingTime: Date;
  readonly nextFundingTime: Date;
  readonly markPrice?: number;
  readonly indexPrice?: number;
  readonly estimatedRate?: number;
}

/**
 * LiquidationEvent is published when a position is force-closed by the exchange.
 * Used by the risk engine to monitor market stress.
 */
export interface LiquidationEvent extends ExchangeModelBase {
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly timeInForce: TimeInForce;
  readonly originalQuantity: number;
  readonly executedQuantity: number;
  readonly price: number;
  readonly averagePrice: number;
  readonly status: OrderStatus;
}

/**
 * MarkPrice is the exchange-computed fair price for futures contracts.
 * Used for P&L calculation and liquidation determination.
 */
export interface MarkPrice extends ExchangeModelBase {
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly settlementPrice: number;
  readonly fundingRate?: number;
  readonly nextFundingTime?: Date;
}
