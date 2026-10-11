import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskConfig } from '@config/risk.config';
import { RiskViolation } from '../../domain/enums/risk-violation.enum';
import { CheckResult, EvaluationContext } from '../../interfaces/risk-evaluator.interface';

@Injectable()
export class PortfolioLimitsService {
  private readonly cfg: RiskConfig;

  constructor(configService: ConfigService) {
    this.cfg = configService.get<RiskConfig>('risk')!;
  }

  check(ctx: EvaluationContext): CheckResult {
    const { portfolio, signal } = ctx;
    const violations: RiskViolation[] = [];

    if (portfolio.equity > 0) {
      const exposurePercent = (portfolio.totalExposure / portfolio.equity) * 100;
      if (exposurePercent >= this.cfg.maxExposurePercent) {
        violations.push(RiskViolation.MAX_EXPOSURE_EXCEEDED);
        return {
          passed: false,
          violations,
          reason: `Exposure ${exposurePercent.toFixed(1)}% exceeds limit ${this.cfg.maxExposurePercent}%`,
        };
      }
    }

    if (portfolio.currentLeverage >= this.cfg.maxLeverage) {
      violations.push(RiskViolation.MAX_LEVERAGE_EXCEEDED);
      return {
        passed: false,
        violations,
        reason: `Leverage ${portfolio.currentLeverage.toFixed(2)}x exceeds limit ${this.cfg.maxLeverage}x`,
      };
    }

    if (portfolio.openPositions.length >= this.cfg.maxOpenOrders) {
      violations.push(RiskViolation.MAX_OPEN_POSITIONS_EXCEEDED);
      return {
        passed: false,
        violations,
        reason: `Open positions ${portfolio.openPositions.length} at limit ${this.cfg.maxOpenOrders}`,
      };
    }

    const symbolPositions = portfolio.openPositions.filter(
      (p) => p.symbol === signal.symbol,
    ).length;
    if (symbolPositions >= this.cfg.maxPositionsPerSymbol) {
      violations.push(RiskViolation.MAX_POSITIONS_PER_SYMBOL_EXCEEDED);
      return {
        passed: false,
        violations,
        reason: `${signal.symbol} already has ${symbolPositions} position(s), limit ${this.cfg.maxPositionsPerSymbol}`,
      };
    }

    if (portfolio.equity > 0) {
      const symbolExposure = portfolio.openPositions
        .filter((p) => p.symbol === signal.symbol)
        .reduce((sum, p) => sum + p.notionalValue, 0);
      const concentrationPercent = (symbolExposure / portfolio.equity) * 100;
      if (concentrationPercent >= this.cfg.maxConcentrationPercent) {
        violations.push(RiskViolation.MAX_POSITIONS_PER_SYMBOL_EXCEEDED);
        return {
          passed: false,
          violations,
          reason: `${signal.symbol} concentration ${concentrationPercent.toFixed(1)}% exceeds ${this.cfg.maxConcentrationPercent}%`,
        };
      }
    }

    return { passed: true, violations: [] };
  }
}
