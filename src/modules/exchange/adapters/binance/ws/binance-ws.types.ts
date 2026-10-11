/**
 * Raw Binance WebSocket message types.
 *
 * INTERNAL USE ONLY — must never be imported outside the binance adapter directory.
 * All data leaving the adapter is mapped to normalized models.
 */

/** Envelope for the combined stream format: wss://stream/stream?streams=... */
export interface BinanceWsStreamEnvelope<T = unknown> {
  readonly stream: string;
  readonly data: T;
}

/** Response to a SUBSCRIBE / UNSUBSCRIBE / LIST_SUBSCRIPTIONS request. */
export interface BinanceWsCommandResponse {
  readonly id: number;
  readonly result: unknown; // null on success
  readonly error?: {
    readonly code: number;
    readonly msg: string;
  };
}

/** 24-hour rolling ticker. Event type: "24hrTicker". */
export interface BinanceWsTickerMessage {
  readonly e: '24hrTicker';
  readonly E: number; // event time (ms)
  readonly s: string; // symbol
  readonly p: string; // price change
  readonly P: string; // price change %
  readonly w: string; // weighted avg price
  readonly x: string; // prev close price
  readonly c: string; // last price
  readonly Q: string; // last qty
  readonly b: string; // best bid
  readonly B: string; // best bid qty
  readonly a: string; // best ask
  readonly A: string; // best ask qty
  readonly o: string; // open price
  readonly h: string; // high price
  readonly l: string; // low price
  readonly v: string; // base volume
  readonly q: string; // quote volume
  readonly O: number; // open time (ms)
  readonly C: number; // close time (ms)
  readonly F: number; // first trade ID
  readonly L: number; // last trade ID
  readonly n: number; // trade count
}

/** Aggregate trade stream. Event type: "aggTrade". */
export interface BinanceWsAggTradeMessage {
  readonly e: 'aggTrade';
  readonly E: number; // event time (ms)
  readonly s: string; // symbol
  readonly a: number; // agg trade ID (sequence)
  readonly p: string; // price
  readonly q: string; // quantity
  readonly f: number; // first trade ID
  readonly l: number; // last trade ID
  readonly T: number; // trade time (ms)
  readonly m: boolean; // is buyer market maker
}

/**
 * Diff depth (incremental order book update). Event type: "depthUpdate".
 * U = first update ID in this event (sequence start)
 * u = last update ID in this event (sequence end)
 * b / a = bid / ask updates: [price, qty] — qty "0" means remove this level
 */
export interface BinanceWsDepthMessage {
  readonly e: 'depthUpdate';
  readonly E: number; // event time (ms)
  readonly s: string; // symbol
  readonly U: number; // first update ID
  readonly u: number; // last update ID
  readonly b: ReadonlyArray<[string, string]>; // bid updates [price, qty]
  readonly a: ReadonlyArray<[string, string]>; // ask updates [price, qty]
}

/**
 * Partial book depth snapshot update (e.g. btcusdt@depth20@100ms).
 * No event type field — the stream name identifies it.
 */
export interface BinanceWsPartialDepthMessage {
  readonly lastUpdateId: number;
  readonly bids: ReadonlyArray<[string, string]>;
  readonly asks: ReadonlyArray<[string, string]>;
}
