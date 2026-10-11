/**
 * ReportSource identifies which trading mode produced the underlying data.
 *
 * BACKTEST     — historical simulation via BacktestEngine
 * PAPER        — live-market simulation via PaperTradingModule (no real capital)
 * LIVE         — real exchange orders with real capital
 * MULTI_SOURCE — report spanning more than one source (e.g. combined comparison)
 */
export enum ReportSource {
  BACKTEST = 'BACKTEST',
  PAPER = 'PAPER',
  LIVE = 'LIVE',
  MULTI_SOURCE = 'MULTI_SOURCE',
}
