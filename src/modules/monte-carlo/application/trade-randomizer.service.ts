import { Injectable } from '@nestjs/common';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { RandomGenerator } from '@shared/random/random-generator.interface';
import { MonteCarloConfig } from '../domain/models/monte-carlo-config.model';

/**
 * TradeRandomizerService
 *
 * Applies stochastic perturbations to individual trade execution costs to
 * model real-world uncertainty that is absent from a deterministic backtest:
 *
 *   randomSlippage   — market-impact slippage beyond the modelled fixed rate
 *   randomCommission — fee variation across venues / volume tiers
 *   randomSpread     — bid-ask spread widening under varying liquidity
 *   randomLatency    — price drift during execution delay
 *
 * All perturbations reduce net PnL (they are costs, not gains).
 * Latency is approximated as 0.001 bps of additional slippage per ms of delay,
 * which is a conservative estimate for liquid crypto spot markets.
 *
 * Implementation note: all cost components are accumulated independently from
 * grossPnl so that commission replacement and additional-cost perturbations
 * cannot interfere with each other.
 */
@Injectable()
export class TradeRandomizerService {
  private static readonly LATENCY_IMPACT_BPS_PER_MS = 0.001;

  /**
   * Returns a new `TradeRecord` with perturbed execution costs.
   * The original object is never mutated.
   *
   * @param trade  Recorded trade from the original backtest.
   * @param config Monte Carlo configuration containing perturbation ranges.
   * @param rng    Injected random-number generator.
   */
  applyRandomization(
    trade: TradeRecord,
    config: MonteCarloConfig,
    rng: RandomGenerator,
  ): TradeRecord {
    const positionValue = trade.entryPrice * trade.quantity;
    if (positionValue <= 0) return trade;

    // Accumulate total execution costs starting from the recorded commission
    // or, when randomCommission is active, a freshly drawn value.
    let commission: number;
    if (config.randomCommission) {
      const bps = rng.nextFloatBetween(
        config.randomCommission.minBps,
        config.randomCommission.maxBps,
      );
      commission = (positionValue * bps) / 10_000;
    } else {
      commission = trade.commission;
    }

    // Additional cost perturbations (each drawn independently and summed).
    let additionalCost = 0;

    if (config.randomSlippage) {
      const bps = rng.nextFloatBetween(config.randomSlippage.minBps, config.randomSlippage.maxBps);
      additionalCost += (positionValue * bps) / 10_000;
    }

    if (config.randomSpread) {
      const bps = rng.nextFloatBetween(config.randomSpread.minBps, config.randomSpread.maxBps);
      additionalCost += (positionValue * bps) / 10_000;
    }

    if (config.randomLatency) {
      const latencyMs = rng.nextFloatBetween(
        config.randomLatency.minMs,
        config.randomLatency.maxMs,
      );
      const impactBps = latencyMs * TradeRandomizerService.LATENCY_IMPACT_BPS_PER_MS;
      additionalCost += (positionValue * impactBps) / 10_000;
    }

    const totalCost = commission + additionalCost;
    const netPnl = trade.grossPnl - totalCost;

    if (commission === trade.commission && additionalCost === 0) {
      return trade; // nothing changed — avoid allocation
    }

    return { ...trade, netPnl, commission };
  }
}
