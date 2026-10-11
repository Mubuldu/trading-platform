/**
 * Types of market and alternative data available in the research sandbox.
 *
 * Standard market data:
 *   OHLCV           — Open/High/Low/Close/Volume candlestick bars
 *   TICK            — Raw trade ticks
 *
 * Alternative data:
 *   FUNDING_RATE    — Perpetual swap funding rates
 *   OPEN_INTEREST   — Aggregate open interest
 *   LIQUIDATIONS    — Forced liquidation events
 *   VOLUME_PROFILE  — Price-level volume distribution
 *   ORDER_BOOK      — Snapshot of the limit order book
 */
export enum ResearchDataType {
  OHLCV = 'OHLCV',
  TICK = 'TICK',
  FUNDING_RATE = 'FUNDING_RATE',
  OPEN_INTEREST = 'OPEN_INTEREST',
  LIQUIDATIONS = 'LIQUIDATIONS',
  VOLUME_PROFILE = 'VOLUME_PROFILE',
  ORDER_BOOK = 'ORDER_BOOK',
}
