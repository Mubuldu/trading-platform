/**
 * SdkTick is a real-time best-bid/best-ask snapshot from the exchange.
 *
 * Published on every quote update from the exchange feed. Strategies that
 * implement onTick() should process these fast — slow handlers delay
 * subsequent ticks for all strategies on the same symbol.
 *
 * spread = bestAsk - bestBid (always >= 0; the platform guarantees no negative spreads).
 * midPrice = (bestBid + bestAsk) / 2.
 */
export interface SdkTick {
  readonly symbol: string;
  readonly exchange: string;
  readonly timestamp: number;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly bestBidQuantity: number;
  readonly bestAskQuantity: number;
  readonly spread: number;
  readonly midPrice: number;
}

/**
 * SdkTrade is a single executed trade from the exchange public trade feed.
 *
 * isBuyerMaker: true  → the buyer was the passive (maker) side
 * isBuyerMaker: false → the buyer was the aggressive (taker) side
 */
export interface SdkTrade {
  readonly symbol: string;
  readonly exchange: string;
  readonly timestamp: number;
  readonly tradeId: string;
  readonly price: number;
  readonly quantity: number;
  readonly quoteQuantity: number;
  readonly side: 'BUY' | 'SELL';
  readonly isBuyerMaker: boolean;
}

/**
 * SdkOrderBookLevel is a single price-quantity level in the L2 order book.
 */
export interface SdkOrderBookLevel {
  readonly price: number;
  readonly quantity: number;
}

/**
 * SdkOrderBook is a normalized L2 order book snapshot.
 *
 * Bids are sorted descending (highest bid first).
 * Asks are sorted ascending (lowest ask first).
 *
 * depth is the number of levels on each side requested from the exchange.
 */
export interface SdkOrderBook {
  readonly symbol: string;
  readonly exchange: string;
  readonly timestamp: number;
  readonly bids: readonly SdkOrderBookLevel[];
  readonly asks: readonly SdkOrderBookLevel[];
  readonly depth: number;
}
