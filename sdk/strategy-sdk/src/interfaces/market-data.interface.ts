import { SdkTick, SdkTrade, SdkOrderBook } from '../market/tick.types';

/**
 * IReadonlyMarketData provides real-time market snapshots to strategies.
 *
 * All methods are synchronous reads of in-memory snapshots maintained by
 * the platform's market-data layer. There are no async calls — no I/O occurs.
 *
 * Requires: StrategyPermission.READ_MARKET_DATA
 *
 * Null returns mean the platform has not yet received data for that symbol.
 * Strategies should handle null gracefully — do not assume data is always present.
 *
 * Order book availability depends on whether the platform has subscribed to
 * the L2 order book feed for that symbol. A null order book is normal for
 * strategies that did not request order-book data in their manifest.
 */
export interface IReadonlyMarketData {
  /** Returns the most recent tick for the given symbol, or null if not yet received. */
  getLatestTick(symbol: string): SdkTick | null;

  /** Returns the most recent public trade for the given symbol, or null if not yet received. */
  getLatestTrade(symbol: string): SdkTrade | null;

  /** Returns the current L2 order book snapshot, or null if not subscribed. */
  getOrderBook(symbol: string): SdkOrderBook | null;
}
