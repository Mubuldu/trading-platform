/**
 * BenchmarkType specifies the comparison benchmark used in analytics reports.
 *
 * BUY_AND_HOLD — buy the same portfolio at start and hold to end
 * BTC          — Bitcoin buy-and-hold return over the same period
 * ETH          — Ethereum buy-and-hold return over the same period
 * SP500        — S&P 500 total return index over the same period
 * CUSTOM       — externally supplied benchmark return series
 */
export enum BenchmarkType {
  BUY_AND_HOLD = 'BUY_AND_HOLD',
  BTC = 'BTC',
  ETH = 'ETH',
  SP500 = 'SP500',
  CUSTOM = 'CUSTOM',
}
