import { Signal } from '@modules/strategy/interfaces/signal.interface';
import { RiskViolation } from '../domain/enums/risk-violation.enum';
import { PortfolioSnapshot } from '../domain/models/portfolio-state.model';

export interface EvaluationContext {
  readonly signal: Signal;
  readonly portfolio: PortfolioSnapshot;
  readonly currentAtr?: number;
  readonly currentVolatility?: number;
}

export interface CheckResult {
  readonly passed: boolean;
  readonly violations: RiskViolation[];
  readonly reason?: string;
}

export interface ReductionResult {
  readonly factor: number;
  readonly violations: RiskViolation[];
}
