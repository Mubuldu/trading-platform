import { Injectable } from '@nestjs/common';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { RandomGenerator } from '@shared/random/random-generator.interface';

/**
 * BootstrapResamplerService
 *
 * Produces a new trade sequence of the same length as the source by sampling
 * WITH REPLACEMENT.  Each call yields an independent bootstrap sample, so
 * running it N times gives a nonparametric approximation of the sampling
 * distribution of any statistic computed from the trades.
 *
 * Statistical note:
 *   Bootstrap resampling is the standard Monte Carlo technique for trading
 *   systems because it makes no distributional assumption about returns —
 *   it uses the empirical distribution implied by the actual trade history.
 */
@Injectable()
export class BootstrapResamplerService {
  /**
   * Returns a bootstrap sample of `trades.length` trades drawn with
   * replacement.  The returned array may contain duplicates and may omit
   * some original trades.
   *
   * @param trades  Source trade list (unmodified).
   * @param rng     Injected random-number generator (seeded for tests).
   */
  resample(trades: TradeRecord[], rng: RandomGenerator): TradeRecord[] {
    const n = trades.length;
    if (n === 0) return [];

    const result: TradeRecord[] = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = trades[rng.nextInt(0, n - 1)];
    }
    return result;
  }
}
