export enum SimulationMethod {
  /** Sample trades with replacement — explores sequence-order sensitivity. */
  BOOTSTRAP_RESAMPLING = 'BOOTSTRAP_RESAMPLING',

  /** Shuffle the chronological trade sequence — cheapest randomisation. */
  RANDOM_TRADE_ORDER = 'RANDOM_TRADE_ORDER',

  /**
   * Bootstrap resampling combined with randomised execution costs
   * (slippage, commission, spread, latency).  Most thorough.
   */
  MONTE_CARLO_FULL = 'MONTE_CARLO_FULL',
}
