/**
 * Ordered stages of the research-to-production promotion pipeline.
 *
 * INVARIANT: No experiment may skip a stage.
 * Numeric values encode the required ordering (higher = further along).
 *
 *   RESEARCH → VALIDATION → WALK_FORWARD → MONTE_CARLO
 *     → PAPER_TRADING → MANUAL_APPROVAL → PRODUCTION
 */
export enum PromotionStage {
  /** Initial stage — experiment exists only in the research sandbox. */
  RESEARCH = 'RESEARCH',

  /** In-sample validation: basic backtest against hold-out period. */
  VALIDATION = 'VALIDATION',

  /** Walk-forward testing across multiple out-of-sample windows. */
  WALK_FORWARD = 'WALK_FORWARD',

  /** Monte Carlo stress testing for robustness and path dependence. */
  MONTE_CARLO = 'MONTE_CARLO',

  /** Live paper trading — real market data, simulated fills. */
  PAPER_TRADING = 'PAPER_TRADING',

  /** Human review required before any production deployment. */
  MANUAL_APPROVAL = 'MANUAL_APPROVAL',

  /** Deployed to live production — experiment is now a production strategy. */
  PRODUCTION = 'PRODUCTION',

  /** Experiment was rejected at some stage and will not advance further. */
  REJECTED = 'REJECTED',
}

/**
 * Numeric ordering of promotion stages for comparison.
 * A stage with a higher order value is further along the pipeline.
 */
export const PROMOTION_STAGE_ORDER: Record<PromotionStage, number> = {
  [PromotionStage.RESEARCH]: 0,
  [PromotionStage.VALIDATION]: 1,
  [PromotionStage.WALK_FORWARD]: 2,
  [PromotionStage.MONTE_CARLO]: 3,
  [PromotionStage.PAPER_TRADING]: 4,
  [PromotionStage.MANUAL_APPROVAL]: 5,
  [PromotionStage.PRODUCTION]: 6,
  [PromotionStage.REJECTED]: -1,
};

/** Ordered list of valid promotion stages (excluding terminal states). */
export const PROMOTION_PIPELINE: PromotionStage[] = [
  PromotionStage.RESEARCH,
  PromotionStage.VALIDATION,
  PromotionStage.WALK_FORWARD,
  PromotionStage.MONTE_CARLO,
  PromotionStage.PAPER_TRADING,
  PromotionStage.MANUAL_APPROVAL,
  PromotionStage.PRODUCTION,
];
