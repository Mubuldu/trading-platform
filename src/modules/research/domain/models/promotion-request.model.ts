import { PromotionStage } from '../enums/promotion-stage.enum';

/**
 * A request to advance an experiment to the next promotion stage,
 * or to reject it at the current stage.
 */
export interface PromotionRequest {
  readonly experimentId: string;
  /** The stage the experiment is being promoted TO (or REJECTED). */
  readonly targetStage: PromotionStage;
  /** Identifier of the person or system initiating the promotion. */
  readonly initiatedBy: string;
  /** Rationale for promotion or rejection. */
  readonly reason: string;
  /**
   * For MANUAL_APPROVAL → PRODUCTION transitions this must be set.
   * It is a second confirmation that live capital will be at risk.
   */
  readonly productionApprovalToken?: string;
  readonly requestedAt: Date;
}

/**
 * The recorded outcome of a promotion request.
 * Stored as part of the experiment's audit log.
 */
export interface PromotionRecord {
  readonly fromStage: PromotionStage;
  readonly toStage: PromotionStage;
  readonly initiatedBy: string;
  readonly reason: string;
  readonly approvedAt: Date;
}

/**
 * Stage-level pass/fail verdict used to gate advancement.
 * Each stage records its own validation result before promotion proceeds.
 */
export interface StageValidationResult {
  readonly stage: PromotionStage;
  readonly passed: boolean;
  readonly metrics: Record<string, number>;
  readonly notes: string;
  readonly validatedAt: Date;
}
