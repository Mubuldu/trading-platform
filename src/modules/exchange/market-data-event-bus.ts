import { EventEmitter } from 'events';
import { Injectable } from '@nestjs/common';

/**
 * MarketDataEventBus is the in-process event bus for real-time market data.
 *
 * Design:
 *  - Exchange adapters PUBLISH normalized events here after receiving and
 *    normalizing WebSocket messages.
 *  - Application modules (strategy engine, risk engine, etc.) SUBSCRIBE here
 *    to receive a continuous stream of market data.
 *
 * Event type constants are defined in MARKET_DATA_EVENTS (common.model.ts).
 *
 * Usage — publisher (inside adapter):
 *   marketDataEventBus.emit(MARKET_DATA_EVENTS.TICKER_UPDATED, ticker);
 *
 * Usage — consumer:
 *   marketDataEventBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, (ticker: Ticker) => { ... });
 *   // Unsubscribe when no longer needed to avoid listener leaks:
 *   marketDataEventBus.off(MARKET_DATA_EVENTS.TICKER_UPDATED, handler);
 *
 * This is intentionally separate from the domain EventBusProvider (which is
 * for DomainEvents and persistence-layer integration). Market data events are
 * high-frequency, ephemeral, and do not require durability or replay semantics.
 */
@Injectable()
export class MarketDataEventBus extends EventEmitter {
  constructor() {
    super();
    // Allow many subscribers (strategy engine, risk engine, monitoring, etc.)
    // without Node.js memory-leak warnings.
    this.setMaxListeners(500);
  }
}
