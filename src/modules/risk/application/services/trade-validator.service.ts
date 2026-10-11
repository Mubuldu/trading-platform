import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { RiskConfig } from '@config/risk.config';
import { RiskViolation } from '../../domain/enums/risk-violation.enum';
import { CheckResult, EvaluationContext } from '../../interfaces/risk-evaluator.interface';

@Injectable()
export class TradeValidatorService {
  private readonly cfg: RiskConfig;

  constructor(configService: ConfigService) {
    this.cfg = configService.get<RiskConfig>('risk')!;
  }

  check(ctx: EvaluationContext): CheckResult {
    const { signal, portfolio } = ctx;
    const violations: RiskViolation[] = [];

    if (signal.direction === SignalDirection.HOLD) {
      return {
        passed: false,
        violations: [],
        reason: 'HOLD signals do not require risk evaluation',
      };
    }

    if (this.cfg.blockedSymbols.includes(signal.symbol)) {
      violations.push(RiskViolation.BLOCKED_SYMBOL);
      return { passed: false, violations, reason: `Symbol "${signal.symbol}" is blocked` };
    }

    if (signal.confidence < this.cfg.minConfidenceThreshold) {
      violations.push(RiskViolation.CONFIDENCE_TOO_LOW);
      return {
        passed: false,
        violations,
        reason: `Confidence ${signal.confidence.toFixed(2)} below threshold ${this.cfg.minConfidenceThreshold}`,
      };
    }

    if (portfolio.availableBalance <= 0) {
      violations.push(RiskViolation.INSUFFICIENT_BALANCE);
      return { passed: false, violations, reason: 'Insufficient available balance' };
    }

    return { passed: true, violations: [] };
  }
}
