import { Signal } from '@modules/strategy/interfaces/signal.interface';
import { RiskDecision } from '../enums/risk-decision.enum';
import { RiskViolation } from '../enums/risk-violation.enum';
import { SizingMethod } from '../enums/sizing-method.enum';

export interface RiskDecisionModel {
  readonly decisionId: string;
  readonly signal: Signal;
  readonly decision: RiskDecision;
  readonly violations: RiskViolation[];
  readonly recommendedSize: number | null;
  readonly recommendedSizeUsd: number | null;
  readonly sizingMethod: SizingMethod | null;
  readonly sizeReductionFactor: number;
  readonly reason: string;
  readonly evaluatedAt: number;
  readonly durationMs: number;
}
