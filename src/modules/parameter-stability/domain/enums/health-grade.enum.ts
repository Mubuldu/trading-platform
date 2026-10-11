/** Six-tier grade assigned by StrategyHealthScorerService. */
export type HealthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

/** Numeric lower-bound (inclusive) for each grade. */
export const HEALTH_GRADE_THRESHOLDS: Record<HealthGrade, number> = {
  'A+': 90,
  A: 80,
  B: 70,
  C: 60,
  D: 50,
  F: 0,
};

export function gradeFromScore(score: number): HealthGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
