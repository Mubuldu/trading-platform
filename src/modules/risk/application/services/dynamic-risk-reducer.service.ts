import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskConfig } from '@config/risk.config';
import { RiskViolation } from '../../domain/enums/risk-violation.enum';
import { EvaluationContext, ReductionResult } from '../../interfaces/risk-evaluator.interface';
import { RiskStateService } from './risk-state.service';

@Injectable()
export class DynamicRiskReducerService {
  private readonly cfg: RiskConfig;

  constructor(
    configService: ConfigService,
    private readonly state: RiskStateService,
  ) {
    this.cfg = configService.get<RiskConfig>('risk')!;
  }

  evaluate(ctx: EvaluationContext): ReductionResult {
    let factor = 1.0;
    const violations: RiskViolation[] = [];

    const drawdown = this.state.getCurrentDrawdownPercent();
    if (drawdown >= this.cfg.drawdownReductionThresholdPercent) {
      factor *= this.cfg.drawdownReductionFactor;
      violations.push(RiskViolation.DRAWDOWN_REDUCTION_APPLIED);
    }

    const consecutiveLosses = this.state.getConsecutiveLosses();
    if (consecutiveLosses >= this.cfg.consecutiveLossReductionThreshold) {
      factor *= this.cfg.consecutiveLossReductionFactor;
      violations.push(RiskViolation.CONSECUTIVE_LOSS_REDUCTION_APPLIED);
    }

    if (
      ctx.currentVolatility !== undefined &&
      ctx.currentVolatility >= this.cfg.volatilityReductionThresholdPercent
    ) {
      factor *= this.cfg.volatilityReductionFactor;
      violations.push(RiskViolation.VOLATILITY_REDUCTION_APPLIED);
    }

    return { factor: Math.max(0.1, Math.min(1.0, factor)), violations };
  }
}
