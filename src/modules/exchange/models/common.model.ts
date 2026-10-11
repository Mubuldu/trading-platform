import { ExchangeId } from '../enums/exchange.enums';

/**
 * NormalizedSymbol is a branded string in BASE/QUOTE format.
 *
 * Brand enforcement prevents accidental raw exchange symbols from being
 * used where a normalized symbol is expected. The compiler rejects it.
 *
 * Format:
 *   Spot:      BTC/USDT
 *   Perpetual: BTC/USDT:USDT   (USDT-margined perpetual)
 *   Inverse:   BTC/USD:BTC     (BTC-margined perpetual)
 *   Quarterly: BTC/USDT:2024-03-29  (delivery futures)
 *
 * Construction: always go through SymbolNormalizer.normalize() or
 * NormalizedSymbol.from() — never cast directly.
 */
export type NormalizedSymbol = string & { readonly _brand: 'NormalizedSymbol' };

export const NormalizedSymbol = {
  /**
   * Unsafe construction — only for use inside normalizers and tests.
   * Do not use in application code; use SymbolNormalizer instead.
   */
  unsafe(value: string): NormalizedSymbol {
    return value as NormalizedSymbol;
  },

  parse(value: string): { base: string; quote: string; settlement?: string } | null {
    const match = /^([A-Z0-9]+)\/([A-Z0-9]+)(?::([A-Z0-9-]+))?$/.exec(value);
    if (!match) return null;
    return {
      base: match[1],
      quote: match[2],
      settlement: match[3],
    };
  },

  isValid(value: string): value is NormalizedSymbol {
    return /^[A-Z0-9]+\/[A-Z0-9]+(?::[A-Z0-9-]+)?$/.test(value);
  },
};

/**
 * ExchangeModelBase is the required header present on every normalized model
 * that originates from an exchange.
 *
 *  exchangeId    — which exchange produced this data
 *  symbol        — the normalized symbol this data pertains to
 *  timestamp     — the event time as reported by the exchange server
 *  receivedAt    — the local system time when this data was received
 *                  (useful for measuring feed latency)
 *  correlationId — the correlation ID of the request that triggered this
 *                  data (empty for unsolicited push data)
 */
export interface ExchangeModelBase {
  readonly exchangeId: ExchangeId;
  readonly symbol: NormalizedSymbol;
  readonly timestamp: Date;
  readonly receivedAt: Date;
  readonly correlationId?: string;
}

/**
 * MarketDataSubscription represents an active streaming subscription to a
 * market data feed.
 *
 * When a subscription is created, the adapter begins publishing events to
 * the internal EventBus. Consumers subscribe to the EventBus using the
 * event type constants defined in MARKET_DATA_EVENTS.
 *
 * unsubscribe() stops the data feed and removes the EventBus publisher.
 * It is always safe to call even if already unsubscribed.
 */
export interface MarketDataSubscription {
  readonly subscriptionId: string;
  readonly symbol: NormalizedSymbol;
  readonly exchangeId: ExchangeId;
  readonly eventTypes: readonly string[];
  unsubscribe(): Promise<void>;
}

/**
 * MARKET_DATA_EVENTS contains the EventBus event type strings for all
 * normalized market data events. Consumers subscribe to these strings.
 *
 * Naming convention: exchange.<data-type>.<action>
 */
export const MARKET_DATA_EVENTS = {
  TICKER_UPDATED: 'exchange.ticker.updated',
  ORDER_BOOK_UPDATED: 'exchange.order_book.updated',
  TRADE_EXECUTED: 'exchange.trade.executed',
  FUNDING_RATE_UPDATED: 'exchange.funding_rate.updated',
  LIQUIDATION_OCCURRED: 'exchange.liquidation.occurred',
  MARK_PRICE_UPDATED: 'exchange.mark_price.updated',
  EXECUTION_REPORT: 'exchange.execution_report',
} as const;

export type MarketDataEventType = (typeof MARKET_DATA_EVENTS)[keyof typeof MARKET_DATA_EVENTS];
