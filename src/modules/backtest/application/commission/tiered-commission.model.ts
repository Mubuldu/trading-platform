import { OrderSide } from '@modules/exchange/enums/order.enums';
import { ICommissionModel } from './interfaces/commission-model.interface';

export interface CommissionTier {
  readonly volumeThresholdUsd: number;
  readonly makerBps: number;
  readonly takerBps: number;
}

export class TieredCommissionModel implements ICommissionModel {
  readonly description: string;

  private readonly sortedTiers: CommissionTier[];

  constructor(
    tiers: CommissionTier[],
    private readonly monthlyVolumeUsd: number,
  ) {
    if (tiers.length === 0) {
      throw new Error('TieredCommissionModel requires at least one tier');
    }
    this.sortedTiers = [...tiers].sort((a, b) => b.volumeThresholdUsd - a.volumeThresholdUsd);
    this.description = `Tiered commission: monthly volume=$${monthlyVolumeUsd.toLocaleString()}, ${tiers.length} tier(s)`;
  }

  calculate(quantity: number, price: number, _side: OrderSide, isMaker: boolean): number {
    const tier = this.resolveTier();
    const bps = isMaker ? tier.makerBps : tier.takerBps;
    return quantity * price * (bps / 10_000);
  }

  private resolveTier(): CommissionTier {
    for (const tier of this.sortedTiers) {
      if (this.monthlyVolumeUsd >= tier.volumeThresholdUsd) {
        return tier;
      }
    }
    return this.sortedTiers[this.sortedTiers.length - 1];
  }
}
