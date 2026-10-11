import { Injectable } from '@nestjs/common';
import { AllocationMethod } from '../../domain/enums/allocation-method.enum';
import {
  AllocationWeight,
  CapitalAllocationModel,
} from '../../domain/models/capital-allocation.model';

@Injectable()
export class CapitalAllocationService {
  compute(
    method: AllocationMethod,
    strategies: string[],
    totalCapital: number,
    options: AllocationOptions = {},
  ): CapitalAllocationModel {
    if (strategies.length === 0) {
      return { method, totalCapital, allocations: [], computedAt: Date.now() };
    }

    let weights: number[];

    switch (method) {
      case AllocationMethod.EQUAL_WEIGHT:
        weights = this.equalWeights(strategies.length);
        break;
      case AllocationMethod.RISK_WEIGHT:
        weights = this.riskWeights(strategies, options.riskValues);
        break;
      case AllocationMethod.VOLATILITY_WEIGHT:
        weights = this.volatilityWeights(strategies, options.volatilityValues);
        break;
      case AllocationMethod.KELLY_WEIGHT:
        weights = this.kellyWeights(strategies, options.kellyValues);
        break;
      case AllocationMethod.CUSTOM:
        weights = this.customWeights(strategies, options.customWeights);
        break;
      default:
        weights = this.equalWeights(strategies.length);
    }

    const allocations: AllocationWeight[] = strategies.map((strategyId, i) => {
      const weight = weights[i];
      const allocatedCapital = totalCapital * weight;
      const maxPositionSize = allocatedCapital * (options.maxPositionSizePercent ?? 0.2);
      return { strategyId, weight, allocatedCapital, maxPositionSize };
    });

    return { method, totalCapital, allocations, computedAt: Date.now() };
  }

  private equalWeights(count: number): number[] {
    const w = 1 / count;
    return Array(count).fill(w);
  }

  private riskWeights(strategies: string[], riskValues?: Map<string, number>): number[] {
    if (!riskValues || riskValues.size === 0) return this.equalWeights(strategies.length);
    const inverseRisks = strategies.map((s) => {
      const risk = riskValues.get(s) ?? 1;
      return risk > 0 ? 1 / risk : 0;
    });
    return this.normalise(inverseRisks);
  }

  private volatilityWeights(strategies: string[], volValues?: Map<string, number>): number[] {
    if (!volValues || volValues.size === 0) return this.equalWeights(strategies.length);
    const inverseVols = strategies.map((s) => {
      const vol = volValues.get(s) ?? 1;
      return vol > 0 ? 1 / vol : 0;
    });
    return this.normalise(inverseVols);
  }

  private kellyWeights(strategies: string[], kellyValues?: Map<string, number>): number[] {
    if (!kellyValues || kellyValues.size === 0) return this.equalWeights(strategies.length);
    const kelly = strategies.map((s) => Math.max(0, kellyValues.get(s) ?? 0));
    const total = kelly.reduce((s, v) => s + v, 0);
    if (total === 0) return this.equalWeights(strategies.length);
    return kelly.map((k) => k / total);
  }

  private customWeights(strategies: string[], customWeights?: Map<string, number>): number[] {
    if (!customWeights || customWeights.size === 0) return this.equalWeights(strategies.length);
    const raw = strategies.map((s) => Math.max(0, customWeights.get(s) ?? 0));
    const total = raw.reduce((s, v) => s + v, 0);
    if (total === 0) return this.equalWeights(strategies.length);
    return raw.map((w) => w / total);
  }

  private normalise(values: number[]): number[] {
    const total = values.reduce((s, v) => s + v, 0);
    if (total === 0) return this.equalWeights(values.length);
    return values.map((v) => v / total);
  }
}

export interface AllocationOptions {
  riskValues?: Map<string, number>;
  volatilityValues?: Map<string, number>;
  kellyValues?: Map<string, number>;
  customWeights?: Map<string, number>;
  maxPositionSizePercent?: number;
}
