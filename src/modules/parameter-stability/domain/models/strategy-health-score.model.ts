import { HealthGrade } from '../enums/health-grade.enum';

/**
 * One scored dimension of the overall health assessment.
 */
export interface HealthDimension {
  readonly name: string;
  /** 0–100. */
  readonly score: number;
  /** Human-readable items that penalised this dimension. */
  readonly penalties: string[];
}

/**
 * Composite strategy health score on a 0–100 scale, broken into three
 * weighted dimensions:
 *
 *   Stability    (40 %) — parameter robustness, sensitivity, region analysis
 *   Robustness   (30 %) — statistical significance (DSR, PSR)
 *   Consistency  (30 %) — win-rate across OOS periods, metric variance
 *
 * Grade thresholds:
 *   A+ ≥ 90 · A ≥ 80 · B ≥ 70 · C ≥ 60 · D ≥ 50 · F < 50
 */
export interface StrategyHealthScore {
  readonly grade: HealthGrade;
  /** Composite weighted score 0–100. */
  readonly numericScore: number;
  readonly stability: HealthDimension;
  readonly robustness: HealthDimension;
  readonly consistency: HealthDimension;
  /** Ordered list of the most important penalty descriptions. */
  readonly topPenalties: string[];
  /**
   * True when the composite score is below 50 (grade D or F) OR when any
   * individual dimension scores below 40.
   */
  readonly isOverfit: boolean;
}
