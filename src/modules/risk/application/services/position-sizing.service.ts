import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskConfig } from '@config/risk.config';
import { SizingMethod } from '../../domain/enums/sizing-method.enum';
import { RiskStateService } from './risk-state.service';

export interface SizingInput {
  readonly equity: number;
  readonly availableBalance: number;
  readonly currentAtr?: number;
  readonly currentPrice?: number;
  readonly currentVolatility?: number;
}

export interface SizingResult {
  readonly sizeUsd: number;
  readonly method: SizingMethod;
}

@Injectable()
export class PositionSizingService {
  private readonly cfg: RiskConfig;

  constructor(
    configService: ConfigService,
    private readonly state: RiskStateService,
  ) {
    this.cfg = configService.get<RiskConfig>('risk')!;
  }

  calculate(input: SizingInput): SizingResult {
    const method = this.resolveMethod(input);
    let sizeUsd: number;

    switch (method) {
      case SizingMethod.ATR:
        sizeUsd = this.atrSize(input);
        break;
      case SizingMethod.FRACTIONAL_KELLY:
        sizeUsd = this.kellySize(input.equity);
        break;
      case SizingMethod.VOLATILITY_TARGETING:
        sizeUsd = this.volatilityTargetSize(input);
        break;
      default:
        sizeUsd = this.fixedFractionalSize(input.equity);
    }

    sizeUsd = Math.min(
      sizeUsd,
      this.cfg.maxPositionSizeUsd,
      this.cfg.maxOrderSizeUsd,
      input.availableBalance,
    );
    sizeUsd = Math.max(0, sizeUsd);

    return { sizeUsd, method };
  }

  private resolveMethod(input: SizingInput): SizingMethod {
    const configured = this.cfg.sizingMethod as SizingMethod;
    if (
      configured === SizingMethod.ATR &&
      (input.currentAtr === undefined || input.currentAtr <= 0)
    ) {
      return SizingMethod.FIXED_FRACTIONAL;
    }
    if (
      configured === SizingMethod.VOLATILITY_TARGETING &&
      (input.currentVolatility === undefined || input.currentVolatility <= 0)
    ) {
      return SizingMethod.FIXED_FRACTIONAL;
    }
    return configured;
  }

  private fixedFractionalSize(equity: number): number {
    return equity * (this.cfg.riskPerTradePercent / 100);
  }

  private atrSize(input: SizingInput): number {
    const { equity, currentAtr, currentPrice } = input;
    if (!currentAtr || currentAtr <= 0 || !currentPrice || currentPrice <= 0) {
      return this.fixedFractionalSize(equity);
    }
    const dollarRisk = equity * (this.cfg.riskPerTradePercent / 100);
    const stopDistanceUsd = currentAtr * this.cfg.atrMultiplier * currentPrice;
    if (stopDistanceUsd <= 0) return this.fixedFractionalSize(equity);
    return dollarRisk / (currentAtr * this.cfg.atrMultiplier);
  }

  private kellySize(equity: number): number {
    const metrics = this.state.getMetrics();
    const kelly = metrics.kellyFraction;
    const fractionalKelly = kelly * this.cfg.kellyFractionMultiplier;
    if (fractionalKelly <= 0) {
      return this.fixedFractionalSize(equity);
    }
    return equity * fractionalKelly;
  }

  private volatilityTargetSize(input: SizingInput): number {
    const { equity, currentVolatility } = input;
    if (!currentVolatility || currentVolatility <= 0) {
      return this.fixedFractionalSize(equity);
    }
    const targetVol = this.cfg.targetVolatilityPercent;
    const volRatio = targetVol / currentVolatility;
    return equity * (this.cfg.riskPerTradePercent / 100) * volRatio;
  }
}
