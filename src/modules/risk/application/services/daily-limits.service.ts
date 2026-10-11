import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskConfig } from '@config/risk.config';
import { RiskViolation } from '../../domain/enums/risk-violation.enum';
import { CheckResult, EvaluationContext } from '../../interfaces/risk-evaluator.interface';
import { RiskStateService } from './risk-state.service';

@Injectable()
export class DailyLimitsService {
  private readonly cfg: RiskConfig;

  constructor(
    configService: ConfigService,
    private readonly state: RiskStateService,
  ) {
    this.cfg = configService.get<RiskConfig>('risk')!;
  }

  check(_ctx: EvaluationContext): CheckResult {
    const violations: RiskViolation[] = [];

    const dailyLoss = this.state.getDailyLoss();
    if (dailyLoss >= this.cfg.maxDailyLossUsd) {
      violations.push(RiskViolation.MAX_DAILY_LOSS_EXCEEDED);
      return {
        passed: false,
        violations,
        reason: `Daily loss $${dailyLoss.toFixed(2)} reached limit $${this.cfg.maxDailyLossUsd}`,
      };
    }

    const drawdown = this.state.getCurrentDrawdownPercent();
    if (drawdown >= this.cfg.maxDrawdownPercent) {
      violations.push(RiskViolation.MAX_DRAWDOWN_EXCEEDED);
      return {
        passed: false,
        violations,
        reason: `Drawdown ${drawdown.toFixed(2)}% reached limit ${this.cfg.maxDrawdownPercent}%`,
      };
    }

    const consecutiveLosses = this.state.getConsecutiveLosses();
    if (consecutiveLosses >= this.cfg.maxConsecutiveLosses) {
      violations.push(RiskViolation.MAX_CONSECUTIVE_LOSSES_EXCEEDED);
      return {
        passed: false,
        violations,
        reason: `${consecutiveLosses} consecutive losses reached limit ${this.cfg.maxConsecutiveLosses}`,
      };
    }

    const dailyTrades = this.state.getDailyTradeCount();
    if (dailyTrades >= this.cfg.dailyTradeLimit) {
      violations.push(RiskViolation.DAILY_TRADE_LIMIT_EXCEEDED);
      return {
        passed: false,
        violations,
        reason: `Daily trade count ${dailyTrades} reached limit ${this.cfg.dailyTradeLimit}`,
      };
    }

    return { passed: true, violations: [] };
  }
}
