import { Injectable } from '@nestjs/common';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { RiskViolation } from '../../domain/enums/risk-violation.enum';
import { CheckResult, EvaluationContext } from '../../interfaces/risk-evaluator.interface';
import { RiskStateService } from './risk-state.service';

@Injectable()
export class EmergencyProtectionService {
  constructor(private readonly state: RiskStateService) {}

  check(ctx: EvaluationContext): CheckResult {
    const violations: RiskViolation[] = [];

    if (this.state.isKillSwitchActive()) {
      violations.push(RiskViolation.KILL_SWITCH_ACTIVE);
      return { passed: false, violations, reason: 'Kill switch is active' };
    }

    if (this.state.isTradingPaused()) {
      violations.push(RiskViolation.TRADING_PAUSED);
      return { passed: false, violations, reason: 'Trading is paused' };
    }

    if (this.state.isExposureLocked() && this.increasesExposure(ctx.signal.direction)) {
      violations.push(RiskViolation.EXPOSURE_LOCKED);
      return {
        passed: false,
        violations,
        reason: 'Exposure is locked — new long/short positions blocked',
      };
    }

    return { passed: true, violations: [] };
  }

  private increasesExposure(direction: SignalDirection): boolean {
    return direction === SignalDirection.BUY || direction === SignalDirection.SELL;
  }
}
